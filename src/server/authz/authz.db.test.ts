/**
 * L'autorisation et l'audit, contre un vrai PostgreSQL.
 *
 * Trois propriétés de cette step ne se prouvent que là :
 *
 * 1. Les permissions sont bien **l'union des rôles**, résolue à l'instant de l'appel — un rôle
 *    retiré retire le pouvoir sans attendre de reconnexion.
 * 2. Une mutation refusée **ne mute rien et n'audite rien** : il ne suffit pas que la fonction rende
 *    un refus, encore faut-il que la base n'ait pas bougé.
 * 3. Un audit refusé **annule la mutation** : « échec d'audit = échec de l'opération », et un
 *    `expect` sur un booléen ne l'établirait jamais — seul un `ROLLBACK` observé le fait.
 *
 * Ce que ce fichier ne peut pas établir : que l'audit passe bien par la transaction et non par le
 * pool. Le refus de payload lance **avant** toute insertion, donc les deux câblages donnent le même
 * résultat observable ici. Cette moitié-là vit dans `mutate.test.ts`.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../auth/password'
import { seedAuth } from '../auth/seed'
import type { SessionState } from '../auth/session'
import { connect, type Database } from '../db/index'
import { operators } from '../db/schema/auth'
import { mutate } from './mutate'
import { AUTHZ_CODES, requirePermission } from './permission'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const
const EMAIL = 'operatrice@example.test'
const IP = '203.0.113.7'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
let operatorId: string
let sessionId: string

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const connection = connect(container.getConnectionUri(), { poolSize: 5 })
  sql = connection.client
  db = connection.db
  await migrate(db, { migrationsFolder: './drizzle' })
  await seedAuth(db)
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

beforeEach(async () => {
  await sql`DELETE FROM audit_log`
  await sql`DELETE FROM operators`

  const [operator] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES (${EMAIL}, 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  operatorId = operator?.id ?? ''

  const [session] = await sql<{ id: string }[]>`
    INSERT INTO operator_sessions (operator_id, expires_at, mfa_completed_at)
    VALUES (${operatorId}, now() + interval '1 hour', now())
    RETURNING id::text
  `
  sessionId = session?.id ?? ''
})

/** Rattache l'opérateur à un rôle par défaut, par son nom. */
async function grantRole(name: string): Promise<void> {
  await sql`
    INSERT INTO operator_roles (operator_id, role_id)
    SELECT ${operatorId}, id FROM roles WHERE name = ${name}
  `
}

const activeSession = (): SessionState => ({ status: 'active', operatorId, sessionId })
const pendingSession = (): SessionState => ({ status: 'pending_mfa', operatorId, sessionId })

/**
 * Les lignes d'audit, lues avec `host(ip_address)` et non `ip_address::text`.
 *
 * Le cast en texte d'un `inet` rend l'adresse **avec son masque** — `203.0.113.7/32` — parce que le
 * type stocke une adresse *et* un préfixe réseau. C'est le bon comportement du type, et c'est le
 * piège de sa lecture : l'écran d'audit (step-184) afficherait un `/32` que personne n'a écrit.
 */
async function auditRows() {
  return sql<
    {
      operator_id: string | null
      action: string
      target_type: string | null
      target_id: string | null
      before_json: unknown
      after_json: unknown
      ip_address: string | null
    }[]
  >`SELECT operator_id::text, action, target_type, target_id, before_json, after_json, host(ip_address) AS ip_address FROM audit_log`
}

async function displayName(): Promise<string | undefined> {
  const [row] = await db
    .select({ name: operators.displayName })
    .from(operators)
    .where(eq(operators.id, operatorId))
  return row?.name
}

describe('requirePermission contre la base', () => {
  it('accorde ce que l’union des rôles contient', async () => {
    await grantRole('account_manager')

    const decision = await requirePermission(db, activeSession(), 'customers:write')

    expect(decision.granted).toBe(true)
  })

  it('refuse ce qu’aucun rôle ne donne', async () => {
    await grantRole('account_manager')

    const decision = await requirePermission(db, activeSession(), 'routes:write')

    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.denied)
  })

  it('retire le pouvoir dès le rôle retiré, sans reconnexion', async () => {
    await grantRole('account_manager')
    expect((await requirePermission(db, activeSession(), 'customers:write')).granted).toBe(true)

    await sql`DELETE FROM operator_roles WHERE operator_id = ${operatorId}`

    // La session est la même — c'est bien la résolution à chaque appel qui est vérifiée ici.
    expect((await requirePermission(db, activeSession(), 'customers:write')).granted).toBe(false)
  })

  it('ne rend rien à un opérateur désactivé, même si l’on force une session active', async () => {
    await grantRole('super_admin')
    await sql`UPDATE operators SET status = 'disabled' WHERE id = ${operatorId}`

    // La session est fabriquée à la main : dans le vrai flux, `readSession` filtre déjà sur le
    // statut et l'opérateur n'arrive jamais ici avec une session active. Ce test couvre la seconde
    // ligne de défense — `resolveOperatorPermissions` filtre aussi — et c'est pourquoi le code rendu
    // est `permission_denied` et non `session_absent`.
    const decision = await requirePermission(db, activeSession(), 'customers:write')

    expect(decision.granted === false && decision.refusal.code).toBe(AUTHZ_CODES.denied)
  })
})

describe('mutate', () => {
  /** La mutation d'exemple : renommer l'opérateur. Une vraie écriture, sur une vraie table. */
  const rename =
    (to: string) => async (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => {
      await tx.update(operators).set({ displayName: to }).where(eq(operators.id, operatorId))
      return { result: to, after: { display_name: to } }
    }

  it('mute et écrit exactement une ligne d’audit', async () => {
    await grantRole('super_admin')

    const outcome = await mutate(
      db,
      {
        session: activeSession(),
        permission: 'operators:manage',
        action: 'operator.rename',
        targetType: 'operator',
        targetId: operatorId,
        ipAddress: IP,
        before: { display_name: 'Opératrice' },
      },
      rename('Opératrice en chef'),
    )

    expect(outcome.granted).toBe(true)
    expect(await displayName()).toBe('Opératrice en chef')

    const rows = await auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      operator_id: operatorId,
      action: 'operator.rename',
      target_type: 'operator',
      target_id: operatorId,
      before_json: { display_name: 'Opératrice' },
      after_json: { display_name: 'Opératrice en chef' },
      ip_address: IP,
    })
  })

  it('sans la permission : ne mute rien et n’audite rien', async () => {
    // Aucun rôle rattaché.
    const outcome = await mutate(
      db,
      { session: activeSession(), permission: 'operators:manage', action: 'operator.rename' },
      rename('Usurpatrice'),
    )

    expect(outcome.granted === false && outcome.refusal.code).toBe(AUTHZ_CODES.denied)
    expect(await displayName()).toBe('Opératrice')
    expect(await auditRows()).toHaveLength(0)
  })

  it('refuse une session sans MFA passée sur une permission d’écriture', async () => {
    await grantRole('super_admin')

    const outcome = await mutate(
      db,
      { session: pendingSession(), permission: 'operators:manage', action: 'operator.rename' },
      rename('Trop pressée'),
    )

    expect(outcome.granted === false && outcome.refusal.code).toBe(AUTHZ_CODES.mfaRequired)
    expect(await displayName()).toBe('Opératrice')
    expect(await auditRows()).toHaveLength(0)
  })

  it('annule la mutation quand le payload d’audit porte un corps de message', async () => {
    await grantRole('super_admin')

    await expect(
      mutate(
        db,
        { session: activeSession(), permission: 'operators:manage', action: 'operator.rename' },
        async (tx) => {
          await tx
            .update(operators)
            .set({ displayName: 'Renommée' })
            .where(eq(operators.id, operatorId))
          return { result: null, after: { text: 'RDV demain 14h' } }
        },
      ),
    ).rejects.toThrow()

    // L'audit a échoué, donc l'opération aussi : un `ROLLBACK` observé, pas un booléen.
    //
    // Ce que ce test **ne** prouve pas, contrairement à ce qui était écrit ici : que les deux
    // écritures partagent une transaction. `checkAuditPayload` lance avant toute insertion, si bien
    // que passer le pool à `recordAudit` laisserait ce test vert — vérifié en mutant. L'identité du
    // querier se prouve dans `mutate.test.ts`, où elle se lit directement.
    expect(await displayName()).toBe('Opératrice')
    expect(await auditRows()).toHaveLength(0)
  })

  it('annule tout quand un secret est glissé dans `before` — et pas seulement dans `after`', async () => {
    await grantRole('super_admin')

    // `before` est fourni par l'appelant **avant** le bloc : c'est le payload le plus facile à
    // remplir sans réfléchir, et il n'était vérifié par aucun test. Retirer sa vérification laissait
    // toute la suite verte, et un `api_key` s'écrivait en base.
    await expect(
      mutate(
        db,
        {
          session: activeSession(),
          permission: 'operators:manage',
          action: 'operator.rename',
          before: { api_key: 'sk-live-42' },
        },
        rename('Renommée'),
      ),
    ).rejects.toThrow(/nom réservé/)

    expect(await displayName()).toBe('Opératrice')
    expect(await auditRows()).toHaveLength(0)
  })

  it('refuse un corps de message glissé dans `target_id`', async () => {
    await grantRole('super_admin')

    await expect(
      mutate(
        db,
        {
          session: activeSession(),
          permission: 'operators:manage',
          action: 'content.read',
          targetId: 'RDV demain 14h chez le docteur',
        },
        rename('Renommée'),
      ),
    ).rejects.toThrow(/identifiant/)

    expect(await auditRows()).toHaveLength(0)
  })

  it('écrit `null` plutôt qu’un objet vide quand rien n’a été journalisé', async () => {
    await grantRole('super_admin')

    await mutate(
      db,
      { session: activeSession(), permission: 'operators:manage', action: 'operator.touch' },
      async () => ({ result: null, after: {} }),
    )

    // `{}` se lirait comme un diff légitimement vide. La relecture après incident (step-184) ne
    // distinguerait pas « pas d'après » de « après vide » — deux choses très différentes.
    const rows = await auditRows()
    expect(rows[0]?.after_json).toBeNull()
  })

  it('n’audite rien quand la mutation elle-même échoue', async () => {
    await grantRole('super_admin')

    await expect(
      mutate(
        db,
        { session: activeSession(), permission: 'operators:manage', action: 'operator.rename' },
        async () => {
          throw new Error('la passerelle a refusé')
        },
      ),
    ).rejects.toThrow('la passerelle a refusé')

    expect(await auditRows()).toHaveLength(0)
  })

  it('écrit `null` plutôt que « unknown » quand l’adresse est indéterminée', async () => {
    await grantRole('super_admin')

    await mutate(
      db,
      {
        session: activeSession(),
        permission: 'operators:manage',
        action: 'operator.rename',
        ipAddress: 'unknown',
      },
      rename('Sans adresse'),
    )

    const rows = await auditRows()
    expect(rows[0]?.ip_address).toBeNull()
  })

  it('laisse la mutation nommer sa cible quand elle ne la connaît qu’après coup', async () => {
    await grantRole('super_admin')

    await mutate(
      db,
      { session: activeSession(), permission: 'operators:manage', action: 'operator.create' },
      async () => ({ result: 'x', targetId: '018f4c1e-0000-7000-8000-00000000beef' }),
    )

    expect((await auditRows())[0]?.target_id).toBe('018f4c1e-0000-7000-8000-00000000beef')
  })
})
