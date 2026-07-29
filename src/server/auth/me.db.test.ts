/** `/auth/me`, contre un vrai PostgreSQL : les permissions sont relues à chaque appel. */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import { currentOperator } from './me'
import { hashPassword } from './password'
import { seedAuth } from './seed'
import { completeMfa, openPendingSession, readSession } from './session'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const RAPIDE = { N: 1024, r: 8, p: 1 } as const

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
let operatorId: string

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
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES ('auditrice@example.test', 'Auditrice', ${await hashPassword('un mot de passe long', RAPIDE)})
    RETURNING id::text
  `
  operatorId = row?.id ?? ''
  await sql`
    INSERT INTO operator_roles (operator_id, role_id)
    SELECT ${operatorId}::uuid, id FROM roles WHERE name = 'auditor'
  `
})

async function sessionFor(state: 'pending' | 'active') {
  const { sessionId } = await openPendingSession(db, operatorId)
  if (state === 'active') await completeMfa(db, sessionId)
  return readSession(db, sessionId)
}

describe('opérateur courant', () => {
  it('rend l identité et l union des permissions pour une session complète', async () => {
    const me = await currentOperator(db, await sessionFor('active'))

    expect(me?.email).toBe('auditrice@example.test')
    expect(me?.displayName).toBe('Auditrice')
    expect(me?.permissions).toEqual(['audit:read'])
    expect(me?.mfaCompleted).toBe(true)
  })

  it('ne donne aucune permission tant que le second facteur n est pas passé', async () => {
    // **Le piège à éviter.** L'interface a besoin de savoir qui s'authentifie pour afficher l'écran
    // du second facteur — mais lui donner les permissions à ce stade permettrait de peindre un
    // tableau de bord complet à quelqu'un qui n'a présenté qu'un mot de passe.
    const me = await currentOperator(db, await sessionFor('pending'))

    expect(me?.email).toBe('auditrice@example.test')
    expect(me?.permissions).toEqual([])
    expect(me?.mfaCompleted).toBe(false)
  })

  it('ne rend rien sans session', async () => {
    expect(await currentOperator(db, { status: 'none' })).toBeUndefined()
  })

  it('reflète un changement de rôle sans reconnexion', async () => {
    // **La raison pour laquelle les permissions ne sont jamais figées dans la session.** Un rôle
    // retiré doit retirer le pouvoir immédiatement ; figé à l'ouverture, il survivrait aussi
    // longtemps que le cookie.
    const session = await sessionFor('active')
    expect((await currentOperator(db, session))?.permissions).toEqual(['audit:read'])

    await sql`DELETE FROM operator_roles WHERE operator_id = ${operatorId}::uuid`

    expect((await currentOperator(db, session))?.permissions).toEqual([])
  })

  it('ne laisse jamais fuir le hachage du mot de passe', async () => {
    // `operatorSafeColumns` existe pour cela ; ce test le prouve du côté qui sort vers le réseau.
    const me = await currentOperator(db, await sessionFor('active'))

    expect(JSON.stringify(me)).not.toContain('$scrypt$')
    expect(me).not.toHaveProperty('passwordHash')
    expect(me).not.toHaveProperty('mfaTotpSecret')
  })
})
