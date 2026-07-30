/**
 * Le magasin d'authentificateurs contre un vrai PostgreSQL.
 *
 * Ce qui ne se prouve que là : une liste JSONB se modifie par lecture-modification-écriture, et c'est
 * le motif qui perd des données en concurrence. Le verrou de ligne est la seule chose qui l'empêche.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { lockHolder, waitUntilBlocked } from '../../test/pg-locks'
import { connect, type Database } from '../db/index'
import { hashPassword } from './password'
import {
  addCredential,
  listCredentials,
  recordCredentialUse,
  renameCredential,
  revokeCredentialUnlessLastFactor,
} from './webauthn-credentials'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
let otherInstance: Database
let otherClient: postgres.Sql
let operatorId: string

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
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES ('operatrice@example.test', 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  operatorId = row?.id ?? ''
})

const credential = (id: string, name = 'MacBook') => ({
  id,
  publicKey: Buffer.from(`cle-publique-${id}`).toString('base64url'),
  counter: 0,
  name,
})

describe('enregistrement', () => {
  it('ajoute un authentificateur et le relit', async () => {
    expect(await addCredential(db, operatorId, credential('cred-a'))).toBe(true)

    const stored = await listCredentials(db, operatorId)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: 'cred-a', name: 'MacBook', counter: 0 })
    expect(stored[0]?.createdAt).toBeTypeOf('string')
  })

  it('refuse un identifiant déjà enregistré', async () => {
    // `excludeCredentials` le dit déjà au navigateur, mais c'est une politesse côté client : sans cette
    // garde, réenregistrer le même appareil ferait croire à deux facteurs là où il n'y en a qu'un.
    await addCredential(db, operatorId, credential('cred-a'))

    expect(await addCredential(db, operatorId, credential('cred-a', 'autre nom'))).toBe(false)
    expect(await listCredentials(db, operatorId)).toHaveLength(1)
  })

  it('donne un nom de repli plutôt que de laisser un libellé vide', async () => {
    await addCredential(db, operatorId, credential('cred-a', '   '))

    expect((await listCredentials(db, operatorId))[0]?.name).toBe('Authentificateur')
  })

  it('borne la longueur du nom', async () => {
    await addCredential(db, operatorId, credential('cred-a', 'x'.repeat(200)))

    expect((await listCredentials(db, operatorId))[0]?.name).toHaveLength(60)
  })

  it("ne perd pas l'enregistrement de qui a lu la liste avant l'autre", async () => {
    // **Le test qui justifie le verrou de ligne**, et l'entrelacement est construit : un `Promise.all`
    // sur deux pools ne se chevauche presque jamais, et laissait passer la version sans verrou —
    // vérifié par mutation.
    //
    // Ici, une transaction tient le verrou puis écrit `cred-a` sans valider ; l'ajout de `cred-b` s'y
    // bloque — on l'observe dans `pg_locks`. Sans verrou, `cred-b` aurait lu la liste vide dans son
    // propre instantané et écraserait `cred-a` : un opérateur croirait détenir deux passkeys là où il
    // n'en a qu'une, et ne le découvrirait qu'en perdant le premier appareil.
    const lock = lockHolder()

    const holder = sql.begin(async (tx) => {
      await tx`SELECT id FROM operators WHERE id = ${operatorId} FOR UPDATE`
      lock.signalAcquired()
      await lock.held
      const first = JSON.stringify([
        { ...credential('cred-a', 'poste'), createdAt: new Date().toISOString() },
      ])
      await tx`UPDATE operators SET mfa_webauthn_credentials = ${first}::jsonb
               WHERE id = ${operatorId}`
    })

    // Le rival n'est armé **qu'après** le signal : voir `lockHolder()`.
    await lock.acquired
    const contender = addCredential(otherInstance, operatorId, credential('cred-b', 'téléphone'))

    // On relâche et on attend les deux **avant** toute assertion : une exception jetée ici laisserait
    // une transaction et une requête en vol, dont le rejet tardif polluerait le test suivant.
    const blocked = await waitUntilBlocked(sql)
    lock.release()
    const added = await contender
    await holder

    expect(blocked, "l'entrelacement n'a pas eu lieu : ce test ne prouve rien").toBe(true)
    expect(added).toBe(true)
    const stored = await listCredentials(db, operatorId)
    expect(stored.map((entry) => entry.id).sort()).toEqual(['cred-a', 'cred-b'])
  })
})

describe('renommage et révocation', () => {
  beforeEach(async () => {
    await addCredential(db, operatorId, credential('cred-a', 'poste'))
    await addCredential(db, operatorId, credential('cred-b', 'téléphone'))
  })

  it('renomme sans toucher aux autres', async () => {
    expect(await renameCredential(db, operatorId, 'cred-a', 'MacBook du bureau')).toBe(true)

    const stored = await listCredentials(db, operatorId)
    expect(stored.find((entry) => entry.id === 'cred-a')?.name).toBe('MacBook du bureau')
    expect(stored.find((entry) => entry.id === 'cred-b')?.name).toBe('téléphone')
  })

  it('refuse de renommer un authentificateur inconnu', async () => {
    expect(await renameCredential(db, operatorId, 'cred-absent', 'x')).toBe(false)
  })

  it('révoque un authentificateur et garde les autres', async () => {
    expect(await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-a')).toBe('revoked')

    expect((await listCredentials(db, operatorId)).map((entry) => entry.id)).toEqual(['cred-b'])
  })

  it('refuse de révoquer un authentificateur inconnu', async () => {
    expect(await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-absent')).toBe(
      'unknown_credential',
    )
  })

  it('refuse de retirer le dernier facteur', async () => {
    await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-a')

    expect(await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-b')).toBe('last_factor')
    expect(await listCredentials(db, operatorId)).toHaveLength(1)
  })

  it('ne laisse pas deux retraits concurrents vider tous les facteurs', async () => {
    // **La course que la garde doit fermer**, et elle ne se ferme que sous le verrou : deux onglets
    // retirent chacun un appareil différent, chacun constate qu'il en reste un autre, et les deux
    // aboutissent — l'opérateur se retrouve sans aucun second facteur.
    //
    // L'entrelacement est construit : une transaction tient le verrou et retire `cred-a` sans valider,
    // le retrait de `cred-b` s'y bloque, et l'on observe cette attente dans `pg_locks`. Une garde lue
    // avant le verrou aurait laissé passer le second.
    const lock = lockHolder()

    const holder = sql.begin(async (tx) => {
      await tx`SELECT id FROM operators WHERE id = ${operatorId} FOR UPDATE`
      lock.signalAcquired()
      await lock.held
      const remaining = JSON.stringify([
        { ...credential('cred-b', 'téléphone'), createdAt: new Date().toISOString() },
      ])
      await tx`UPDATE operators SET mfa_webauthn_credentials = ${remaining}::jsonb
               WHERE id = ${operatorId}`
    })

    await lock.acquired
    const contender = revokeCredentialUnlessLastFactor(otherInstance, operatorId, 'cred-b')

    const blocked = await waitUntilBlocked(sql)
    lock.release()
    const outcome = await contender
    await holder

    expect(blocked, "l'entrelacement n'a pas eu lieu : ce test ne prouve rien").toBe(true)
    expect(outcome).toBe('last_factor')
    expect((await listCredentials(db, operatorId)).map((entry) => entry.id)).toEqual(['cred-b'])
  })

  it('accepte de retirer la dernière passkey si un TOTP est actif', async () => {
    await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-a')
    await sql`UPDATE operators SET mfa_totp_secret = 'v1.peu-importe', mfa_totp_activated_at = now()
              WHERE id = ${operatorId}`

    expect(await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-b')).toBe('revoked')
    expect(await listCredentials(db, operatorId)).toEqual([])
  })

  it("ne touche pas aux authentificateurs d'un autre opérateur", async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO operators (email, display_name, password_hash)
      VALUES ('autre@example.test', 'Autre', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
      RETURNING id::text
    `
    const otherOperatorId = row?.id ?? ''
    await addCredential(db, otherOperatorId, credential('cred-a', 'le sien'))

    await revokeCredentialUnlessLastFactor(db, operatorId, 'cred-a')

    expect((await listCredentials(db, otherOperatorId)).map((entry) => entry.id)).toEqual([
      'cred-a',
    ])
  })
})

describe('compteur de signature', () => {
  beforeEach(async () => {
    await addCredential(db, operatorId, { ...credential('cred-a'), counter: 5 })
  })

  it('consigne un compteur qui progresse', async () => {
    expect(await recordCredentialUse(db, operatorId, 'cred-a', 6)).toBe(true)

    const stored = (await listCredentials(db, operatorId))[0]
    expect(stored?.counter).toBe(6)
    expect(stored?.lastUsedAt).toBeTypeOf('string')
  })

  it('refuse un compteur qui recule ou stagne', async () => {
    // La détection de clonage de la spécification : un authentificateur dupliqué finit par présenter
    // une valeur qui n'avance plus, et c'est ce refus qui la rend utile.
    expect(await recordCredentialUse(db, operatorId, 'cred-a', 5)).toBe(false)
    expect(await recordCredentialUse(db, operatorId, 'cred-a', 4)).toBe(false)
    expect((await listCredentials(db, operatorId))[0]?.counter).toBe(5)
  })

  it('refuse un compteur annoncé à zéro contre un compteur déjà avancé', async () => {
    // **La condition est un OU, et l'écrire en ET était une faille.** Un appareil qui annonce toujours
    // zéro aurait pu faire reculer un compteur déjà à cinq, et rendre la détection de clonage
    // inopérante pour toujours.
    expect(await recordCredentialUse(db, operatorId, 'cred-a', 0)).toBe(false)
    expect((await listCredentials(db, operatorId))[0]?.counter).toBe(5)
  })

  it('accepte un compteur resté à zéro', async () => {
    // Les passkeys synchronisées laissent délibérément le compteur à zéro : leur refuser l'usage
    // écarterait le facteur que la spécification recommande le plus.
    await addCredential(db, operatorId, credential('cred-zero'))

    expect(await recordCredentialUse(db, operatorId, 'cred-zero', 0)).toBe(true)
  })

  it('refuse de consigner un authentificateur inconnu', async () => {
    expect(await recordCredentialUse(db, operatorId, 'cred-absent', 9)).toBe(false)
  })
})

describe('colonne illisible', () => {
  it('se lit comme une absence, sans lever', async () => {
    // Une colonne bricolée en exploitation doit aboutir à un refus, jamais à une erreur serveur qui
    // rendrait la panne indiscernable d'une attaque.
    await sql`UPDATE operators SET mfa_webauthn_credentials = '"pas un tableau"'::jsonb WHERE id = ${operatorId}`

    expect(await listCredentials(db, operatorId)).toEqual([])
  })

  it('écarte les entrées incomplètes plutôt que la liste entière', async () => {
    await sql`UPDATE operators SET mfa_webauthn_credentials =
      '[{"id":"bon","publicKey":"cGs","counter":0,"name":"n","createdAt":"x"},{"id":"incomplet"}]'::jsonb
      WHERE id = ${operatorId}`

    expect((await listCredentials(db, operatorId)).map((entry) => entry.id)).toEqual(['bon'])
  })
})
