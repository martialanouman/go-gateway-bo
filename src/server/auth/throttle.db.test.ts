/** Le compteur d'échecs, contre un vrai PostgreSQL : c'est le SQL qui porte la logique de fenêtre. */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import {
  clearFailures,
  lockState,
  purgeStaleAttempts,
  registerFailure,
  subjectKey,
  THRESHOLDS,
} from './throttle'

const POSTGRES_IMAGE = 'postgres:18-alpine'

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start()
  const connection = connect(container.getConnectionUri(), { poolSize: 5 })
  sql = connection.client
  db = connection.db
  await migrate(db, { migrationsFolder: './drizzle' })
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

beforeEach(async () => {
  await sql`TRUNCATE login_attempts`
})

/** Amène un sujet juste sous son seuil, sans le verrouiller. */
async function failUpTo(scope: 'operator' | 'ip', subject: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await registerFailure(db, scope, subject)
}

describe('compteur d échecs', () => {
  it('ne verrouille pas avant le seuil', async () => {
    await failUpTo('operator', 'sujet-a', THRESHOLDS.operator - 1)

    expect(await lockState(db, 'operator', 'sujet-a')).toEqual({ locked: false })
  })

  it('verrouille au seuil exact', async () => {
    await failUpTo('operator', 'sujet-b', THRESHOLDS.operator)

    expect((await lockState(db, 'operator', 'sujet-b')).locked).toBe(true)
  })

  it('ne divulgue jamais l échéance d un verrou de compte', async () => {
    // Annoncer « réessayez dans 15 minutes » confirmerait l'existence du compte, et un attaquant peut
    // provoquer ce verrouillage à volonté : il énumérerait en bloquant.
    await failUpTo('operator', 'sujet-c', THRESHOLDS.operator)

    expect(await lockState(db, 'operator', 'sujet-c')).toEqual({ locked: true })
  })

  it('divulgue l échéance d un verrou d adresse', async () => {
    // L'adresse est l'appelant : lui dire quand revenir ne révèle rien qu'il ne sache déjà.
    await failUpTo('ip', '203.0.113.7', THRESHOLDS.ip)

    const state = await lockState(db, 'ip', '203.0.113.7')
    expect(state.locked).toBe(true)
    expect(state.until).toBeInstanceOf(Date)
  })

  it('compte les deux portées séparément', async () => {
    await failUpTo('operator', 'partagé', THRESHOLDS.operator)

    expect((await lockState(db, 'ip', 'partagé')).locked).toBe(false)
  })

  it('oublie les échecs sortis de la fenêtre', async () => {
    // Sans oubli, un opérateur qui se trompe quatre fois en six mois se retrouverait verrouillé au
    // cinquième essai, des mois plus tard, sans comprendre.
    await failUpTo('operator', 'sujet-d', THRESHOLDS.operator - 1)
    await sql`UPDATE login_attempts SET window_started_at = now() - interval '2 hours' WHERE subject = 'sujet-d'`

    await registerFailure(db, 'operator', 'sujet-d')

    const [row] = await sql<{ failures: number }[]>`
      SELECT failures FROM login_attempts WHERE subject = 'sujet-d'
    `
    expect(row?.failures).toBe(1)
    expect((await lockState(db, 'operator', 'sujet-d')).locked).toBe(false)
  })

  it('considère un verrou échu comme ouvert, sans nettoyage', async () => {
    await failUpTo('operator', 'sujet-e', THRESHOLDS.operator)
    await sql`UPDATE login_attempts SET locked_until = now() - interval '1 minute' WHERE subject = 'sujet-e'`

    expect((await lockState(db, 'operator', 'sujet-e')).locked).toBe(false)
  })

  it('allonge le verrouillage à chaque échec au-delà du seuil', async () => {
    // Comparé en secondes epoch côté base : le pilote rend `timestamptz` sous des formes qui
    // dépendent de sa configuration, et comparer des représentations testerait le pilote.
    const echeance = async () => {
      const [row] = await sql<{ epoch: string }[]>`
        SELECT extract(epoch FROM locked_until)::text AS epoch
        FROM login_attempts WHERE subject = 'sujet-f'
      `
      return Number(row?.epoch)
    }

    await failUpTo('operator', 'sujet-f', THRESHOLDS.operator)
    const premier = await echeance()

    await registerFailure(db, 'operator', 'sujet-f')

    expect(await echeance()).toBeGreaterThan(premier)
  })

  it('ne laisse pas une rafale parallèle passer sous le seuil', async () => {
    // **Le test qui justifie l'`INSERT … ON CONFLICT`.** Un `SELECT` puis `UPDATE` verrait dix
    // requêtes concurrentes lire toutes la même valeur et écrire toutes la suivante : le compteur
    // s'arrêterait à deux, précisément sous la charge qu'il doit compter.
    await Promise.all(Array.from({ length: 10 }, () => registerFailure(db, 'operator', 'rafale')))

    const [row] = await sql<{ failures: number }[]>`
      SELECT failures FROM login_attempts WHERE subject = 'rafale'
    `
    expect(row?.failures).toBe(10)
  })

  it('efface le compteur après une authentification réussie', async () => {
    await failUpTo('operator', 'sujet-g', 3)

    await clearFailures(db, 'operator', 'sujet-g')

    expect(await sql`SELECT 1 FROM login_attempts WHERE subject = 'sujet-g'`).toHaveLength(0)
  })
})

describe('purge des lignes dormantes', () => {
  it('retire les lignes anciennes et déverrouillées', async () => {
    // La table est alimentée par des sujets **tentés**, donc par un attaquant : sans purge, sa
    // croissance est pilotée par lui.
    await registerFailure(db, 'operator', 'ancien')
    await sql`UPDATE login_attempts SET updated_at = now() - interval '60 days' WHERE subject = 'ancien'`

    expect(await purgeStaleAttempts(db)).toBe(1)
    expect(await sql`SELECT 1 FROM login_attempts`).toHaveLength(0)
  })

  it('garde une ligne récente', async () => {
    await registerFailure(db, 'operator', 'récent')

    expect(await purgeStaleAttempts(db)).toBe(0)
  })

  it('garde une ligne ancienne encore verrouillée', async () => {
    // Purger un verrou actif le lèverait : la purge deviendrait un moyen de contourner le blocage.
    await failUpTo('operator', 'bloqué', THRESHOLDS.operator)
    await sql`UPDATE login_attempts SET updated_at = now() - interval '60 days' WHERE subject = 'bloqué'`

    expect(await purgeStaleAttempts(db)).toBe(0)
  })
})

describe('clé de sujet', () => {
  it('rend une adresse IP telle quelle', () => {
    expect(subjectKey('ip', '203.0.113.7', 'secret-de-test-suffisamment-long')).toBe('203.0.113.7')
  })

  it('ne laisse jamais un identifiant apparaître en clair', () => {
    // Cette table recueille ce qui a été **tenté**, pas ce qui existe : les suppositions d'un
    // attaquant, et les mots de passe que des opérateurs tapent dans le champ email par erreur.
    const identifiant = 'operateur@example.test'
    const clef = subjectKey('operator', identifiant, 'secret-de-test-suffisamment-long')

    expect(clef).not.toContain(identifiant)
    expect(clef).not.toContain('example')
    expect(clef).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignore la casse et les espaces, comme l unicité des opérateurs', () => {
    const secret = 'secret-de-test-suffisamment-long'

    expect(subjectKey('operator', '  Operateur@Example.test ', secret)).toBe(
      subjectKey('operator', 'operateur@example.test', secret),
    )
  })

  it('donne des clés différentes sous des secrets différents', () => {
    // C'est ce que le HMAC apporte sur un condensat nu : sans la clé, le dictionnaire ne sert à rien.
    expect(subjectKey('operator', 'a@b.test', 'premier-secret-de-test-assez-long')).not.toBe(
      subjectKey('operator', 'a@b.test', 'second-secret-de-test-assez-long!'),
    )
  })
})
