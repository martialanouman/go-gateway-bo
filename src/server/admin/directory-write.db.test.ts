/**
 * Les mutations de l'annuaire, contre un vrai PostgreSQL.
 *
 * Ce fichier existe pour les **garde-fous**, pas pour les écritures : qu'un `UPDATE` écrive est le
 * genre de propriété qu'un typage donne déjà. Ce qui ne se donne pas tout seul, c'est qu'un
 * administrateur ne puisse pas se fermer la porte, ni fermer la console à tout le monde — et les
 * deux se prouvent contre des données, jamais contre une intention.
 *
 * Le dernier `describe` est le seul qui prouve quelque chose sur la **concurrence** : deux retraits
 * qui se chevauchent laisseraient sinon zéro administrateur, chacun ayant vu l'autre encore en
 * place. `Promise.all` ne le montrerait pas — voir `src/test/pg-locks.ts`.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { lockHolder, waitUntilBlocked } from '~/test/pg-locks'
import { hashPassword } from '../auth/password'
import { seedAuth } from '../auth/seed'
import { connect, type Database } from '../db/index'
import { listOperators, listRoles } from './directory'
import {
  createOperator,
  createRole,
  DirectoryRuleError,
  deleteRole,
  resetOperatorMfa,
  setOperatorRoles,
  setOperatorStatus,
  updateRole,
} from './directory-write'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database

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
  await sql`DELETE FROM operator_sessions`
  await sql`DELETE FROM operator_roles`
  await sql`DELETE FROM operators`
  await sql`DELETE FROM roles WHERE is_default = false`
})

async function insertOperator(email: string, roleNames: readonly string[] = []): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES (${email}, ${'Opérateur'}, ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  const id = row?.id ?? ''

  for (const name of roleNames) {
    await sql`
      INSERT INTO operator_roles (operator_id, role_id)
      VALUES (${id}::uuid, (SELECT id FROM roles WHERE name = ${name}))
    `
  }

  return id
}

async function roleIdNamed(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id::text FROM roles WHERE name = ${name}`
  return row?.id ?? ''
}

/** Un rôle taillé pour administrer sans être `super_admin` — c'est ce qui rend les gardes visibles. */
async function insertAdminRole(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO roles (name, description) VALUES (${name}, ${'Administration seule'})
    RETURNING id::text
  `
  const id = row?.id ?? ''
  await sql`
    INSERT INTO role_permissions (role_id, permission_key)
    VALUES (${id}::uuid, 'operators:manage'), (${id}::uuid, 'roles:manage')
  `
  return id
}

async function openSession(operatorId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operator_sessions (operator_id, mfa_completed_at, expires_at)
    VALUES (${operatorId}::uuid, now(), now() + interval '1 hour')
    RETURNING id::text
  `
  return row?.id ?? ''
}

async function activeSessionCount(operatorId: string): Promise<number> {
  const [row] = await sql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM operator_sessions
    WHERE operator_id = ${operatorId}::uuid AND revoked_at IS NULL
  `
  return row?.total ?? 0
}

/** Rend l'erreur de règle levée par le bloc, ou `undefined` s'il a abouti. */
async function refusalOf(run: () => Promise<unknown>): Promise<DirectoryRuleError | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    if (error instanceof DirectoryRuleError) return error
    throw error
  }
}

describe('la création d’un opérateur', () => {
  it('attache les rôles demandés', async () => {
    const ops = await roleIdNamed('ops')
    const passwordHash = await hashPassword('un mot de passe long', FAST_SCRYPT)

    const created = await db.transaction((tx) =>
      createOperator(tx, {
        email: 'nouveau@example.test',
        displayName: 'Nouveau',
        passwordHash,
        roleIds: [ops],
      }),
    )

    const operator = (await listOperators(db)).find((row) => row.id === created.operatorId)

    expect(operator?.status).toBe('active')
    expect(operator?.roles.map((role) => role.name)).toEqual(['ops'])
    expect(operator?.mfaEnrolled).toBe(false)
  })

  it('refuse une adresse déjà prise, quelle qu’en soit la casse', async () => {
    await insertOperator('DEJA@example.test')

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        createOperator(tx, {
          email: 'deja@example.test',
          displayName: 'Doublon',
          passwordHash: 'peu importe',
          roleIds: [],
        }),
      ),
    )

    // Refusé **avant** l'insertion, et pas rattrapé sur la contrainte : une violation d'index
    // avorte la transaction, si bien que le message rendu ne serait plus celui d'un produit mais
    // celui de PostgreSQL.
    expect(refusal?.code).toBe('duplicate_email')
  })

  it('refuse un rôle qui n’existe plus', async () => {
    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        createOperator(tx, {
          email: 'nouveau@example.test',
          displayName: 'Nouveau',
          passwordHash: 'peu importe',
          roleIds: ['00000000-0000-7000-8000-000000000000'],
        }),
      ),
    )

    expect(refusal?.code).toBe('unknown_role')
  })
})

describe('le statut d’un opérateur', () => {
  it('met fin aux sessions ouvertes en désactivant', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const target = await insertOperator('cible@example.test', ['ops'])
    await openSession(target)
    await openSession(target)

    const outcome = await db.transaction((tx) =>
      setOperatorStatus(tx, actor, { operatorId: target, status: 'disabled' }),
    )

    expect(outcome.closedSessions).toBe(2)
    expect(await activeSessionCount(target)).toBe(0)
  })

  it('ne ferme rien en réactivant', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const target = await insertOperator('cible@example.test', ['ops'])
    await sql`UPDATE operators SET status = 'disabled' WHERE id = ${target}::uuid`

    const outcome = await db.transaction((tx) =>
      setOperatorStatus(tx, actor, { operatorId: target, status: 'active' }),
    )

    expect(outcome.closedSessions).toBe(0)
  })

  it('refuse de se désactiver soi-même', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        setOperatorStatus(tx, actor, { operatorId: actor, status: 'disabled' }),
      ),
    )

    expect(refusal?.code).toBe('self_lockout')
    // La garde n'annule pas seulement l'action : elle annule la transaction entière, sessions
    // comprises. Un statut resté « actif » avec des sessions fermées serait le pire des deux états.
    expect((await listOperators(db)).find((row) => row.id === actor)?.status).toBe('active')
  })

  it('refuse de désactiver le dernier super_admin', async () => {
    const adminRole = await insertAdminRole('administration')
    const actor = await insertOperator('admin@example.test')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${actor}::uuid, ${adminRole}::uuid)`
    const owner = await insertOperator('proprietaire@example.test', ['super_admin'])

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        setOperatorStatus(tx, actor, { operatorId: owner, status: 'disabled' }),
      ),
    )

    expect(refusal?.code).toBe('last_super_admin')
    expect((await listOperators(db)).find((row) => row.id === owner)?.status).toBe('active')
  })

  it('laisse désactiver un super_admin tant qu’il en reste un', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const other = await insertOperator('second@example.test', ['super_admin'])

    await db.transaction((tx) =>
      setOperatorStatus(tx, actor, { operatorId: other, status: 'disabled' }),
    )

    expect((await listOperators(db)).find((row) => row.id === other)?.status).toBe('disabled')
  })
})

describe('les rôles d’un opérateur', () => {
  it('remplace l’ensemble plutôt qu’il ne l’ajoute', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const target = await insertOperator('cible@example.test', ['ops', 'auditor'])
    const compliance = await roleIdNamed('compliance')

    await db.transaction((tx) =>
      setOperatorRoles(tx, actor, { operatorId: target, roleIds: [compliance] }),
    )

    const operator = (await listOperators(db)).find((row) => row.id === target)
    expect(operator?.roles.map((role) => role.name)).toEqual(['compliance'])
  })

  it('refuse de se retirer operators:manage', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const auditor = await roleIdNamed('auditor')

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        setOperatorRoles(tx, actor, { operatorId: actor, roleIds: [auditor] }),
      ),
    )

    expect(refusal?.code).toBe('self_lockout')
    expect(refusal?.message).toContain('operators:manage')
  })
})

describe('la réinitialisation du second facteur', () => {
  it('efface les deux facteurs, les codes de récupération et les sessions', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const target = await insertOperator('cible@example.test', ['ops'])
    await sql`
      UPDATE operators
      SET mfa_totp_secret = 'enveloppe-chiffree', mfa_totp_activated_at = now(),
          mfa_totp_last_step = 42, mfa_webauthn_credentials = '[{"id":"c1"}]'::jsonb
      WHERE id = ${target}::uuid
    `
    await sql`
      INSERT INTO operator_recovery_codes (operator_id, code_hash)
      VALUES (${target}::uuid, 'condensat')
    `
    await openSession(target)

    const outcome = await db.transaction((tx) =>
      resetOperatorMfa(tx, actor, { operatorId: target }),
    )

    const [row] = await sql<{ secret: string | null; step: number | null; devices: number }[]>`
      SELECT mfa_totp_secret AS secret, mfa_totp_last_step AS step,
             jsonb_array_length(mfa_webauthn_credentials)::int AS devices
      FROM operators WHERE id = ${target}::uuid
    `
    const [codes] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM operator_recovery_codes WHERE operator_id = ${target}::uuid
    `

    expect(outcome.closedSessions).toBe(1)
    expect(row?.secret).toBeNull()
    // Le pas anti-rejeu suit le secret : le laisser derrière ferait refuser les premiers codes du
    // facteur suivant, sans que rien ne le dise.
    expect(row?.step).toBeNull()
    expect(row?.devices).toBe(0)
    expect(codes?.total).toBe(0)
    expect((await listOperators(db)).find((r) => r.id === target)?.mfaEnrolled).toBe(false)
  })

  it('refuse de réinitialiser le sien', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    const refusal = await refusalOf(() =>
      db.transaction((tx) => resetOperatorMfa(tx, actor, { operatorId: actor })),
    )

    expect(refusal?.code).toBe('self_mfa_reset')
  })
})

describe('les rôles', () => {
  it('se créent avec leur paquet', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    const created = await db.transaction((tx) =>
      createRole(tx, actor, {
        name: 'exploitation_nuit',
        description: 'Astreinte de nuit',
        permissions: ['sessions:read', 'connectors:read'],
      }),
    )

    const role = (await listRoles(db)).find((row) => row.id === created.roleId)

    expect(role?.isDefault).toBe(false)
    expect([...(role?.permissions ?? [])]).toEqual(['connectors:read', 'sessions:read'])
  })

  it('refusent un nom déjà pris', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        createRole(tx, actor, { name: 'ops', description: 'Doublon', permissions: [] }),
      ),
    )

    expect(refusal?.code).toBe('duplicate_role_name')
  })

  it('laissent modifier le paquet d’un rôle par défaut', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const auditor = await roleIdNamed('auditor')

    await db.transaction((tx) =>
      updateRole(tx, actor, {
        roleId: auditor,
        name: 'auditor',
        description: 'Revue de conformité',
        permissions: ['audit:read', 'alerts:read'],
      }),
    )

    const role = (await listRoles(db)).find((row) => row.id === auditor)
    expect([...(role?.permissions ?? [])]).toEqual(['alerts:read', 'audit:read'])
  })

  it('refusent de renommer un rôle par défaut', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const auditor = await roleIdNamed('auditor')

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        updateRole(tx, actor, {
          roleId: auditor,
          name: 'auditeur',
          description: 'Revue de conformité',
          permissions: ['audit:read'],
        }),
      ),
    )

    // Le seed réinsère les rôles par défaut **par nom** : un rôle renommé serait recréé au
    // déploiement suivant, et l'installation se retrouverait avec les deux.
    expect(refusal?.code).toBe('default_role_locked')
  })

  it('refusent d’être supprimés quand ils sont livrés avec le produit', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const ops = await roleIdNamed('ops')

    const refusal = await refusalOf(() =>
      db.transaction((tx) => deleteRole(tx, actor, { roleId: ops })),
    )

    expect(refusal?.code).toBe('default_role_locked')
    expect((await listRoles(db)).some((row) => row.name === 'ops')).toBe(true)
  })

  it('se suppriment et quittent ceux qui les portaient', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])
    const custom = await insertAdminRole('a_supprimer')
    const holder = await insertOperator('porteur@example.test')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${holder}::uuid, ${custom}::uuid)`

    const outcome = await db.transaction((tx) => deleteRole(tx, actor, { roleId: custom }))

    expect(outcome.holders).toBe(1)
    expect((await listRoles(db)).some((row) => row.id === custom)).toBe(false)
    expect((await listOperators(db)).find((row) => row.id === holder)?.roles).toEqual([])
  })

  it('refusent une édition qui retirerait roles:manage à son auteur', async () => {
    const adminRole = await insertAdminRole('administration')
    const actor = await insertOperator('admin@example.test')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${actor}::uuid, ${adminRole}::uuid)`
    // Un super_admin doit rester, sinon c'est l'autre garde qui refuserait et le test ne dirait
    // plus rien de celle-ci.
    await insertOperator('proprietaire@example.test', ['super_admin'])

    const refusal = await refusalOf(() =>
      db.transaction((tx) =>
        updateRole(tx, actor, {
          roleId: adminRole,
          name: 'administration',
          description: 'Administration seule',
          permissions: ['operators:manage'],
        }),
      ),
    )

    expect(refusal?.code).toBe('self_lockout')
    expect(refusal?.message).toContain('roles:manage')
  })
})

describe('une cible qui a disparu pendant que l’écran était ouvert', () => {
  const ABSENT = '00000000-0000-7000-8000-000000000000'

  it('se dit, plutôt que de laisser une mise à jour ne toucher aucune ligne', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    // Sans ces contrôles, l'`UPDATE` réussirait en ne touchant rien : l'écran annoncerait un succès
    // et le journal d'audit porterait une ligne pour une action qui n'a rien fait.
    const status = await refusalOf(() =>
      db.transaction((tx) =>
        setOperatorStatus(tx, actor, { operatorId: ABSENT, status: 'disabled' }),
      ),
    )
    const roles = await refusalOf(() =>
      db.transaction((tx) => setOperatorRoles(tx, actor, { operatorId: ABSENT, roleIds: [] })),
    )
    const mfa = await refusalOf(() =>
      db.transaction((tx) => resetOperatorMfa(tx, actor, { operatorId: ABSENT })),
    )

    expect([status?.code, roles?.code, mfa?.code]).toEqual([
      'unknown_operator',
      'unknown_operator',
      'unknown_operator',
    ])
  })

  it('vaut aussi pour un rôle supprimé par quelqu’un d’autre', async () => {
    const actor = await insertOperator('admin@example.test', ['super_admin'])

    const edition = await refusalOf(() =>
      db.transaction((tx) =>
        updateRole(tx, actor, {
          roleId: ABSENT,
          name: 'disparu',
          description: 'Disparu',
          permissions: [],
        }),
      ),
    )
    const suppression = await refusalOf(() =>
      db.transaction((tx) => deleteRole(tx, actor, { roleId: ABSENT })),
    )

    expect([edition?.code, suppression?.code]).toEqual(['unknown_role', 'unknown_role'])
  })
})

describe('deux administrateurs qui agissent en même temps', () => {
  it('ne peuvent pas retirer chacun un super_admin et n’en laisser aucun', async () => {
    const adminRole = await insertAdminRole('administration')
    const actor = await insertOperator('admin@example.test')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${actor}::uuid, ${adminRole}::uuid)`
    const first = await insertOperator('premier@example.test', ['super_admin'])
    const second = await insertOperator('second@example.test', ['super_admin'])

    const holder = lockHolder()

    const leading = db.transaction(async (tx) => {
      await setOperatorStatus(tx, actor, { operatorId: first, status: 'disabled' })
      holder.signalAcquired()
      await holder.held
    })

    await holder.acquired

    // Armée seulement maintenant : deux transactions lancées ensemble ne se chevauchent presque
    // jamais, et le test passerait sans aucune garde.
    const trailing = db
      .transaction((tx) => setOperatorStatus(tx, actor, { operatorId: second, status: 'disabled' }))
      .then(() => undefined)
      .catch((error: unknown) => error)

    const blocked = await waitUntilBlocked(sql)
    holder.release()
    await leading
    const outcome = await trailing

    expect(blocked).toBe(true)
    expect(outcome).toBeInstanceOf(DirectoryRuleError)
    expect((await listOperators(db)).filter((row) => row.status === 'active').length).toBe(2)
  })
})
