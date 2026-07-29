/**
 * Les codes de récupération contre un vrai PostgreSQL.
 *
 * L'usage unique et le remplacement de lot sont des propriétés de la base, pas du code : une garde
 * écrite en TypeScript ne tient pas entre deux instances, et c'est précisément entre deux instances
 * qu'un code rejoué arrive.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import {
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  generateRecoveryCodes,
  hashRecoveryCode,
  RECOVERY_CODE_COUNT,
  replaceRecoveryCodes,
} from './mfa-recovery'
import { readMfaKeys } from './mfa-secret'
import { hashPassword } from './password'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const
const KEYS = readMfaKeys({ AUTH_MFA_SECRET: 'une-cle-mfa-de-test-suffisamment-longue-pour' })

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
/** Un second pool : deux instances de la console, pas deux requêtes du même process. */
let otherInstance: Database
let otherClient: postgres.Sql
let operatorId: string
let otherOperatorId: string

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const connection = connect(container.getConnectionUri(), { poolSize: 5 })
  sql = connection.client
  db = connection.db
  await migrate(db, { migrationsFolder: './drizzle' })

  const other = connect(container.getConnectionUri(), { poolSize: 5 })
  otherClient = other.client
  otherInstance = other.db
}, 180_000)

afterAll(async () => {
  await otherClient?.end({ timeout: 5 })
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

beforeEach(async () => {
  await sql`DELETE FROM operators`
  operatorId = await insertOperator('operatrice@example.test')
  otherOperatorId = await insertOperator('autre@example.test')
})

async function insertOperator(email: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES (${email}, 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  return row?.id ?? ''
}

describe('enregistrement du lot', () => {
  it('stocke des condensats, jamais les codes', async () => {
    const codes = generateRecoveryCodes()

    await replaceRecoveryCodes(db, operatorId, codes, KEYS)

    const rows = await sql<{ code_hash: string }[]>`
      SELECT code_hash FROM operator_recovery_codes WHERE operator_id = ${operatorId}
    `
    expect(rows).toHaveLength(RECOVERY_CODE_COUNT)
    for (const code of codes) {
      expect(rows.some((row) => row.code_hash.includes(code))).toBe(false)
      expect(rows.some((row) => row.code_hash === hashRecoveryCode(code, KEYS))).toBe(true)
    }
  })

  it('invalide le lot précédent', async () => {
    // Régénérer un lot est ce qu'on fait après avoir perdu son téléphone. Si les anciens codes
    // restaient valables, le geste ne servirait à rien.
    const first = generateRecoveryCodes()
    await replaceRecoveryCodes(db, operatorId, first, KEYS)

    await replaceRecoveryCodes(db, operatorId, generateRecoveryCodes(), KEYS)

    expect(await consumeRecoveryCode(db, operatorId, first[0] ?? '', KEYS)).toBe(false)
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT)
  })

  it("ne touche pas au lot d'un autre opérateur", async () => {
    const mine = generateRecoveryCodes()
    await replaceRecoveryCodes(db, operatorId, mine, KEYS)
    await replaceRecoveryCodes(db, otherOperatorId, generateRecoveryCodes(), KEYS)

    await replaceRecoveryCodes(db, operatorId, generateRecoveryCodes(), KEYS)

    expect(await countUnusedRecoveryCodes(db, otherOperatorId)).toBe(RECOVERY_CODE_COUNT)
  })
})

describe('consommation', () => {
  let codes: string[]

  beforeEach(async () => {
    codes = generateRecoveryCodes()
    await replaceRecoveryCodes(db, operatorId, codes, KEYS)
  })

  it('accepte un code une fois, et une seule', async () => {
    const code = codes[0] ?? ''

    expect(await consumeRecoveryCode(db, operatorId, code, KEYS)).toBe(true)
    expect(await consumeRecoveryCode(db, operatorId, code, KEYS)).toBe(false)
  })

  it('décompte les codes restants', async () => {
    await consumeRecoveryCode(db, operatorId, codes[0] ?? '', KEYS)
    await consumeRecoveryCode(db, operatorId, codes[1] ?? '', KEYS)

    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT - 2)
  })

  it('garde la ligne consommée, datée', async () => {
    // On marque plutôt qu'on ne supprime : « il vous reste trois codes » se calcule là-dessus, et le
    // journal d'audit (step-025) référencera la ligne.
    await consumeRecoveryCode(db, operatorId, codes[0] ?? '', KEYS)

    const rows = await sql<{ used_at: string | null }[]>`
      SELECT used_at FROM operator_recovery_codes
      WHERE operator_id = ${operatorId} AND used_at IS NOT NULL
    `
    expect(rows).toHaveLength(1)
    expect(Number.isNaN(Date.parse(rows[0]?.used_at ?? ''))).toBe(false)
  })

  it("refuse le code d'un autre opérateur", async () => {
    // Le condensat est le même pour tout le monde — c'est un HMAC, pas un hachage salé. Sans le
    // filtre sur l'opérateur, un lot connu deviendrait une clé passe-partout.
    await replaceRecoveryCodes(db, otherOperatorId, generateRecoveryCodes(), KEYS)

    expect(await consumeRecoveryCode(db, otherOperatorId, codes[0] ?? '', KEYS)).toBe(false)
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT)
  })

  it('refuse un code inventé', async () => {
    expect(await consumeRecoveryCode(db, operatorId, 'ABCDE-FGHJK', KEYS)).toBe(false)
  })

  it('accepte la saisie telle que la tape un opérateur', async () => {
    const code = (codes[0] ?? '').toLowerCase().replace('-', ' ')

    expect(await consumeRecoveryCode(db, operatorId, code, KEYS)).toBe(true)
  })

  it("n'accorde le même code qu'à une seule instance", async () => {
    // Deux pools distincts, donc deux backends PostgreSQL qui se disputent la ligne — pas deux
    // requêtes ordonnancées par le même process. L'ordre reste celui que l'ordonnanceur veut : ce
    // test ne prouve pas l'absence de course, il prouve que l'écriture conditionnelle en désigne un
    // seul gagnant quand elle a lieu.
    const code = codes[0] ?? ''

    const outcomes = await Promise.all([
      consumeRecoveryCode(db, operatorId, code, KEYS),
      consumeRecoveryCode(otherInstance, operatorId, code, KEYS),
    ])

    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT - 1)
  })
})
