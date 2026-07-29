/**
 * L'authentification par mot de passe, contre un vrai PostgreSQL.
 *
 * Ce fichier teste surtout ce qui **ne doit pas se voir** : l'écart entre un identifiant connu et un
 * inconnu, entre un compte verrouillé et un mot de passe faux. Ces propriétés-là ne se vérifient pas
 * sur des mocks — elles dépendent des allers-retours réels vers la base.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import { createSemaphore } from './concurrency'
import { createLoginService, type LoginService } from './login'
import { hashPassword } from './password'
import { seedAuth } from './seed'
import { THRESHOLDS } from './throttle'

const POSTGRES_IMAGE = 'postgres:18-alpine'

/** Paramètres allégés : ce fichier teste des chemins, pas le coût de scrypt. */
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const
const SECRET = 'un-secret-de-throttle-de-test-assez-long'
const PASSWORD = 'un mot de passe assez long'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
let service: LoginService

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
  await sql`TRUNCATE login_attempts`
  await sql`TRUNCATE operators CASCADE`
  await sql`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES ('Operateur@Example.test', 'Opératrice', ${await hashPassword(PASSWORD, FAST_SCRYPT)})
  `
  // Plancher très bas : les tests vérifient les décisions, pas l'horloge. Le plancher réel a son
  // propre describe, avec sa propre instance.
  service = createLoginService({
    db,
    throttleSecret: SECRET,
    semaphore: createSemaphore({ slots: 4, queueLimit: 50 }),
    parameters: FAST_SCRYPT,
    floorMs: 1,
  })
})

const CLIENT_IP = '203.0.113.10'

describe('authentification par mot de passe', () => {
  it('rend un challenge MFA, jamais une session', async () => {
    // La session n'existe qu'après le second facteur (step-022 à 024) : un mot de passe volé ne
    // suffit pas. Si ce test venait un jour à rendre autre chose qu'un challenge, c'est que
    // quelqu'un aurait raccourci le chemin.
    const result = await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    expect(result.outcome).toBe('mfa_required')
    expect(result).not.toHaveProperty('session')
    expect(result).not.toHaveProperty('token')
  })

  it('accepte l identifiant sans distinguer la casse ni les espaces', async () => {
    // L'unicité est posée sur `lower(email)` : se connecter doit suivre la même règle, sinon une
    // majuscule interdit l'accès à un compte qui existe.
    const result = await service.attempt({
      identifier: '  OPERATEUR@EXAMPLE.TEST ',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    expect(result.outcome).toBe('mfa_required')
  })

  it('refuse un mot de passe faux', async () => {
    const result = await service.attempt({
      identifier: 'operateur@example.test',
      password: 'pas le bon mot de passe',
      ipAddress: CLIENT_IP,
    })

    expect(result).toEqual({ outcome: 'invalid_credentials' })
  })

  it('refuse un identifiant inconnu exactement comme un mot de passe faux', async () => {
    // Même forme de réponse, au champ près : toute différence — un code distinct, un champ en plus —
    // énumère les comptes aussi sûrement qu'un message explicite.
    const unknownIdentifier = await service.attempt({
      identifier: 'personne@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })
    const wrongPassword = await service.attempt({
      identifier: 'operateur@example.test',
      password: 'pas le bon mot de passe',
      ipAddress: CLIENT_IP,
    })

    expect(unknownIdentifier).toEqual(wrongPassword)
  })

  it('refuse un opérateur désactivé sans le dire', async () => {
    await sql`UPDATE operators SET status = 'disabled'`

    const result = await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    expect(result).toEqual({ outcome: 'invalid_credentials' })
  })

  it('compte un échec sur les deux portées, identifiant connu ou non', async () => {
    // **Le test qui ferme l'oracle d'écriture.** Ne compter que les identifiants existants rendrait
    // le chemin « inconnu » plus court d'une écriture Postgres — mesurable, donc exploitable.
    await service.attempt({
      identifier: 'personne@example.test',
      password: 'peu importe',
      ipAddress: CLIENT_IP,
    })

    const rows = await sql<
      { scope: string }[]
    >`SELECT scope::text FROM login_attempts ORDER BY scope`
    expect(rows.map((row) => row.scope)).toEqual(['ip', 'operator'])
  })

  it('efface le compteur du compte après une réussite, mais jamais celui de l adresse', async () => {
    // **Le succès ne remet pas le quota d'adresse à zéro.** Sinon quiconque détient un compte valide
    // — y compris un compte peu privilégié déjà compromis — recommencerait son balayage à volonté :
    // dix-neuf échecs sur d'autres identifiants, une connexion réussie sur le sien, et le compteur
    // repart. Derrière une sortie NAT partagée, le succès d'un opérateur effacerait de la même façon
    // ce qu'un attaquant colocalisé accumulait.
    await service.attempt({
      identifier: 'operateur@example.test',
      password: 'raté',
      ipAddress: CLIENT_IP,
    })

    await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    const rows = await sql<{ scope: string }[]>`SELECT scope::text FROM login_attempts`
    expect(rows.map((row) => row.scope)).toEqual(['ip'])
  })

  it('ne prolonge pas le verrou d un compte déjà verrouillé', async () => {
    // **Déni de service ciblé, sinon.** La durée de verrouillage double à chaque échec au-delà du
    // seuil : ré-incrémenter un compte déjà verrouillé ferait que le titulaire légitime, en tapant
    // son bon mot de passe, ré-armerait son propre blocage — et qu'une poignée de requêtes par
    // quart d'heure suffirait à garder un opérateur nommé dehors indéfiniment. Dans un cockpit
    // interne dont les adresses sont devinables, cela ne coûte rien à monter.
    for (let i = 0; i < THRESHOLDS.operator; i++) {
      await service.attempt({
        identifier: 'operateur@example.test',
        password: 'raté',
        ipAddress: `198.51.100.${i}`,
      })
    }

    const deadline = async () => {
      const [row] = await sql<{ epoch: string }[]>`
        SELECT extract(epoch FROM locked_until)::text AS epoch
        FROM login_attempts WHERE scope = 'operator'
      `
      return Number(row?.epoch)
    }
    const before = await deadline()

    await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: '198.51.100.201',
    })

    expect(await deadline()).toBe(before)
  })
})

describe('verrouillage', () => {
  it('refuse un compte verrouillé sans jamais l annoncer', async () => {
    // Un « compte verrouillé » explicite confirmerait son existence — et un attaquant peut provoquer
    // ce verrouillage quand il veut. Il énumérerait en bloquant.
    for (let i = 0; i < THRESHOLDS.operator; i++) {
      await service.attempt({
        identifier: 'operateur@example.test',
        password: 'raté',
        ipAddress: `198.51.100.${i}`,
      })
    }

    const result = await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: '198.51.100.200',
    })

    expect(result).toEqual({ outcome: 'invalid_credentials' })
  })

  it('annonce en revanche le refus d une adresse, avec le délai', async () => {
    // L'adresse est l'appelant : lui dire quand revenir ne lui apprend rien qu'il ignore.
    for (let i = 0; i < THRESHOLDS.ip; i++) {
      await service.attempt({
        identifier: `inconnu${i}@example.test`,
        password: 'raté',
        ipAddress: CLIENT_IP,
      })
    }

    const result = await service.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    expect(result.outcome).toBe('rate_limited')
    if (result.outcome === 'rate_limited') {
      expect(result.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('rejette une adresse bloquée sans consommer de place de vérification', async () => {
    // **L'ordre des coûts.** Le compteur d'adresse doit rejeter *avant* la prise de ticket : sinon un
    // attaquant depuis une seule adresse remplit la file et empêche les connexions légitimes, alors
    // qu'il est déjà identifié comme indésirable.
    for (let i = 0; i < THRESHOLDS.ip; i++) {
      await service.attempt({
        identifier: `inconnu${i}@example.test`,
        password: 'raté',
        ipAddress: CLIENT_IP,
      })
    }

    // Un sémaphore sans aucune place : si le rejet passait par lui, cet appel n'aboutirait jamais.
    const saturated = createLoginService({
      db,
      throttleSecret: SECRET,
      semaphore: createSemaphore({ slots: 0, queueLimit: 0 }),
      parameters: FAST_SCRYPT,
      floorMs: 1,
    })

    const result = await saturated.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: CLIENT_IP,
    })

    expect(result.outcome).toBe('rate_limited')
  })

  it('traduit une file pleine en refus d adresse, pas en erreur', async () => {
    // Uniforme, donc muet sur les comptes : un 500 ou un message distinct ferait de la saturation
    // elle-même un canal d'énumération.
    const saturated = createLoginService({
      db,
      throttleSecret: SECRET,
      semaphore: createSemaphore({ slots: 0, queueLimit: 0 }),
      parameters: FAST_SCRYPT,
      floorMs: 1,
    })

    const result = await saturated.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: '198.51.100.250',
    })

    expect(result.outcome).toBe('rate_limited')
  })
})

describe('plancher de latence', () => {
  it('fait partir toutes les réponses à la même échéance', async () => {
    // Le chemin « identifiant inconnu » est naturellement plus court : pas de compte à lire, et sans
    // l'empreinte factice, pas de scrypt à payer. Le plancher est ce qui rend les deux
    // indiscernables — et il couvre aussi les écritures asymétriques, qu'une égalisation branche par
    // branche raterait à la première modification.
    const FLOOR_MS = 300
    const measured = createLoginService({
      db,
      throttleSecret: SECRET,
      semaphore: createSemaphore({ slots: 4, queueLimit: 50 }),
      parameters: FAST_SCRYPT,
      floorMs: FLOOR_MS,
    })

    const timed = async (identifier: string, password: string) => {
      const start = Date.now()
      await measured.attempt({ identifier, password, ipAddress: '192.0.2.55' })
      return Date.now() - start
    }

    const unknownIdentifier = await timed('personne@example.test', PASSWORD)
    const wrongPassword = await timed('operateur@example.test', 'raté')
    const success = await timed('operateur@example.test', PASSWORD)

    for (const [label, elapsed] of [
      ['inconnu', unknownIdentifier],
      ['mot de passe faux', wrongPassword],
      ['succès', success],
    ] as const) {
      expect(elapsed, label).toBeGreaterThanOrEqual(FLOOR_MS - 20)
      expect(elapsed, label).toBeLessThan(FLOOR_MS + 250)
    }

    expect(measured.deadlineMisses()).toBe(0)
  })

  it('compte les dépassements plutôt que de les taire', async () => {
    // Un dépassement est un **incident de sécurité** : la durée de réponse redevient fonction du
    // chemin parcouru, et c'est l'attaquant qui choisit le moment en produisant la charge.
    const unreachableFloor = createLoginService({
      db,
      throttleSecret: SECRET,
      semaphore: createSemaphore({ slots: 4, queueLimit: 50 }),
      parameters: FAST_SCRYPT,
      floorMs: 0,
    })

    await unreachableFloor.attempt({
      identifier: 'operateur@example.test',
      password: PASSWORD,
      ipAddress: '192.0.2.77',
    })

    expect(unreachableFloor.deadlineMisses()).toBe(1)
  })
})

describe('empreinte factice', () => {
  it('fait payer à un identifiant inconnu le même ordre de coût qu à un compte réel', async () => {
    // **Le test qui rend l'empreinte factice nécessaire.** Sans elle, le chemin « identifiant
    // inconnu » n'appelle jamais scrypt et rend la main en quelques millisecondes, là où un compte
    // existant paie le prix d'une vérification. Le plancher de latence masque cet écart — c'est son
    // rôle — si bien qu'il faut mesurer **plancher désarmé**, sinon rien ne prouve que l'empreinte
    // serve. Vérifié par mutation : la remplacer par une chaîne vide laissait tous les autres tests
    // de ce fichier au vert.
    //
    // Paramètres volontairement plus coûteux que `RAPIDE` : à une milliseconde de vérification,
    // l'écart se perdrait dans le bruit de l'ordonnanceur.
    const COSTLY_SCRYPT = { N: 16_384, r: 8, p: 1 } as const
    await sql`
      INSERT INTO operators (email, display_name, password_hash)
      VALUES ('couteux@example.test', 'Coûteux', ${await hashPassword(PASSWORD, COSTLY_SCRYPT)})
    `

    const withoutFloor = createLoginService({
      db,
      throttleSecret: SECRET,
      semaphore: createSemaphore({ slots: 4, queueLimit: 50 }),
      parameters: COSTLY_SCRYPT,
      floorMs: 0,
    })

    const timed = async (identifier: string) => {
      const start = Date.now()
      await withoutFloor.attempt({
        identifier,
        password: 'un mot de passe faux',
        ipAddress: '192.0.2.99',
      })
      return Date.now() - start
    }

    // Le premier appel dérive l'empreinte factice ; le coût de cette dérivation n'appartient pas à
    // la mesure.
    await timed('amorcage@example.test')

    const knownIdentifier = await timed('couteux@example.test')
    const unknownIdentifier = await timed('absent@example.test')

    // La vérification domine les deux chemins : un inconnu qui coûterait une fraction du connu
    // signalerait que scrypt a été sauté.
    expect(unknownIdentifier).toBeGreaterThan(knownIdentifier / 3)
  })
})
