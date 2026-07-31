/**
 * L'annuaire, contre un vrai PostgreSQL.
 *
 * Trois propriétés ne se prouvent que là, et chacune correspond à un risque de la step :
 *
 * 1. **Aucun secret ne sort.** La règle est écrite sur `operatorSafeColumns` ; ce qui compte est que
 *    la valeur rendue ne les porte pas, quel que soit le chemin.
 * 2. **L'aperçu d'impact ne compte que les retraits**, et il les compte contre l'état réel de la
 *    base — un ajout ne peut casser personne, et le compter noierait le seul chiffre qui doit faire
 *    hésiter.
 * 3. **Les rôles se replient sans N+1.** Un regroupement fait en mémoire se vérifie sur des données,
 *    pas sur une intention.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../auth/password'
import { seedAuth } from '../auth/seed'
import { connect, type Database } from '../db/index'
import {
  listOperators,
  listRoles,
  previewPermissionChange,
  readOperatorSnapshot,
  readRoleSnapshot,
} from './directory'

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
  await sql`DELETE FROM operator_roles`
  await sql`DELETE FROM operators`
  await sql`DELETE FROM roles WHERE is_default = false`
})

/** Crée un opérateur et rend son identifiant. Le mot de passe n'a aucune importance ici. */
async function createOperator(email: string, displayName = 'Opérateur'): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES (${email}, ${displayName}, ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  return row?.id ?? ''
}

async function roleIdNamed(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id::text FROM roles WHERE name = ${name}`
  return row?.id ?? ''
}

describe('la liste des opérateurs', () => {
  it('ne porte ni condensat de mot de passe ni secret TOTP', async () => {
    // **L'invariant qui compte ici.** Un `select()` sans argument aurait emporté les deux jusqu'à
    // une réponse HTTP, et rien à l'écran ne l'aurait montré. On sérialise la valeur rendue et on
    // cherche les secrets réels — pas les noms de colonnes, qu'un renommage ferait disparaître du
    // test sans rien changer à la fuite.
    const secret = 'un-secret-totp-chiffre-qui-ne-doit-pas-sortir'
    const hash = await hashPassword('un mot de passe long', FAST_SCRYPT)
    await sql`
      INSERT INTO operators (email, display_name, password_hash, mfa_totp_secret)
      VALUES ('fuite@example.test', 'Fuite', ${hash}, ${secret})
    `

    const serialized = JSON.stringify(await listOperators(db))

    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(hash)
  })

  it('dit qu’un facteur existe sans dire lequel', async () => {
    await createOperator('sans-facteur@example.test')
    await sql`
      INSERT INTO operators (email, display_name, password_hash, mfa_totp_activated_at)
      VALUES ('totp@example.test', 'TOTP', ${await hashPassword('un mot de passe long', FAST_SCRYPT)}, now())
    `
    await sql`
      INSERT INTO operators (email, display_name, password_hash, mfa_webauthn_credentials)
      VALUES ('passkey@example.test', 'Passkey', ${await hashPassword('un mot de passe long', FAST_SCRYPT)}, '[{"id":"c1"}]'::jsonb)
    `

    const byEmail = new Map((await listOperators(db)).map((row) => [row.email, row]))

    // Les deux facteurs comptent, et un compte sans aucun se voit — c'est ce qui permet à un
    // administrateur de repérer qui ne pourra pas entrer.
    expect(byEmail.get('sans-facteur@example.test')?.mfaEnrolled).toBe(false)
    expect(byEmail.get('totp@example.test')?.mfaEnrolled).toBe(true)
    expect(byEmail.get('passkey@example.test')?.mfaEnrolled).toBe(true)
  })

  it('replie les rôles de chaque opérateur', async () => {
    const first = await createOperator('un@example.test')
    const second = await createOperator('deux@example.test')
    const admin = await roleIdNamed('super_admin')
    const readonlyRole = await roleIdNamed('billing_readonly')

    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${first}::uuid, ${admin}::uuid)`
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${first}::uuid, ${readonlyRole}::uuid)`

    const byId = new Map((await listOperators(db)).map((row) => [row.id, row]))

    expect(byId.get(first)?.roles.map((role) => role.name)).toEqual([
      'billing_readonly',
      'super_admin',
    ])
    // Et un opérateur sans rôle rend une liste vide, jamais `undefined` : un écran qui ferait
    // `.map()` dessus tomberait.
    expect(byId.get(second)?.roles).toEqual([])
  })
})

describe('la liste des rôles', () => {
  it('porte les permissions et le nombre de porteurs', async () => {
    const operator = await createOperator('porteur@example.test')
    const admin = await roleIdNamed('super_admin')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${operator}::uuid, ${admin}::uuid)`

    const superAdmin = (await listRoles(db)).find((role) => role.name === 'super_admin')

    expect(superAdmin?.isDefault).toBe(true)
    expect(superAdmin?.operatorCount).toBe(1)
    expect(superAdmin?.permissions).toContain('operators:manage')
  })

  it('rend zéro porteur plutôt qu’un trou pour un rôle que personne ne porte', async () => {
    const unused = (await listRoles(db)).find((role) => role.operatorCount === 0)

    expect(unused).toBeDefined()
    expect(unused?.operatorCount).toBe(0)
  })
})

describe('l’état d’avant, pour le journal d’audit', () => {
  it('rend rôles et permissions triés, sans les recoller', async () => {
    const operator = await createOperator('audite@example.test')
    const admin = await roleIdNamed('super_admin')
    const auditor = await roleIdNamed('auditor')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${operator}::uuid, ${admin}::uuid)`
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${operator}::uuid, ${auditor}::uuid)`

    // Le tri n'est pas cosmétique : deux lignes d'audit consécutives doivent se comparer, et un
    // ordre d'insertion ferait passer un simple changement d'ordre pour une modification.
    expect(await readOperatorSnapshot(db, operator)).toEqual({
      status: 'active',
      roles: ['auditor', 'super_admin'],
    })
    expect(await readRoleSnapshot(db, auditor)).toEqual({
      name: 'auditor',
      description: expect.any(String),
      permissions: ['audit:read'],
    })
  })

  it('rend rien du tout pour une cible disparue', async () => {
    // L'écran était ouvert, quelqu'un d'autre a supprimé la ligne. Auditer un état vide ferait
    // croire à une modification.
    expect(await readOperatorSnapshot(db, '00000000-0000-7000-8000-000000000000')).toBeUndefined()
    expect(await readRoleSnapshot(db, '00000000-0000-7000-8000-000000000000')).toBeUndefined()
  })
})

describe('l’aperçu d’impact', () => {
  it('ne compte que ce qui est retiré', async () => {
    const role = await roleIdNamed('billing_readonly')
    const operator = await createOperator('facturation@example.test')
    await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${operator}::uuid, ${role}::uuid)`

    const current = (await listRoles(db)).find((row) => row.id === role)?.permissions ?? []

    // Un ajout ne peut casser personne : le compter noierait le seul chiffre qui appelle une
    // hésitation.
    const added = await previewPermissionChange(db, role, [...current, 'operators:manage'])
    expect(added).toEqual({ removedPermissions: [], affectedOperators: 0 })

    const removed = await previewPermissionChange(db, role, [])
    expect(removed.removedPermissions).toEqual([...current].sort())
    expect(removed.affectedOperators).toBe(1)
  })

  it('compte les porteurs réels, pas une estimation', async () => {
    const role = await roleIdNamed('billing_readonly')
    for (const email of ['a@example.test', 'b@example.test', 'c@example.test']) {
      const id = await createOperator(email)
      await sql`INSERT INTO operator_roles (operator_id, role_id) VALUES (${id}::uuid, ${role}::uuid)`
    }

    expect((await previewPermissionChange(db, role, [])).affectedOperators).toBe(3)
  })
})
