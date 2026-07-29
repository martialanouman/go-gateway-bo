/** Le cycle de vie des sessions, contre un vrai PostgreSQL : c'est la base qui fait autorité. */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import { hashPassword } from './password'
import {
  completeMfa,
  openPendingSession,
  purgeDeadSessions,
  readSession,
  revokeAllSessionsOf,
  revokeSession,
} from './session'

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
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await container?.stop()
})

beforeEach(async () => {
  await sql`DELETE FROM operator_sessions`
  await sql`DELETE FROM operators`
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES ('operateur@example.test', 'Opératrice', ${await hashPassword('un mot de passe long', RAPIDE)})
    RETURNING id::text
  `
  operatorId = row?.id ?? ''
})

describe('ouverture de session', () => {
  it('ouvre une session partielle, jamais complète', async () => {
    // **Une session ne naît jamais complète**, même pour un opérateur sans MFA enrôlé : le contraire
    // ouvrirait un chemin où le mot de passe seul suffit, ce que la step-021 existe pour empêcher.
    const { sessionId } = await openPendingSession(db, operatorId)

    expect(await readSession(db, sessionId)).toEqual({
      status: 'pending_mfa',
      sessionId,
      operatorId,
    })
  })

  it('devient active une fois le second facteur passé', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)

    await completeMfa(db, sessionId)

    expect((await readSession(db, sessionId)).status).toBe('active')
  })

  it('ne repromeut pas une session déjà complète', async () => {
    // `completeMfa` doit être sans effet la seconde fois : sinon une session complète verrait sa
    // date de passage MFA rafraîchie à chaque appel, ce qui masquerait depuis quand elle l'est.
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)
    const [avant] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM mfa_completed_at)::text AS epoch FROM operator_sessions
    `

    await completeMfa(db, sessionId)

    const [apres] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM mfa_completed_at)::text AS epoch FROM operator_sessions
    `
    expect(apres?.epoch).toBe(avant?.epoch)
  })
})

describe('lecture de session', () => {
  it('ne rend rien pour un identifiant inconnu', async () => {
    expect(await readSession(db, '01890a5d-ac96-774b-bcce-000000000000')).toEqual({
      status: 'none',
    })
  })

  it('ne rend rien pour une session révoquée', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)

    await revokeSession(db, sessionId)

    expect(await readSession(db, sessionId)).toEqual({ status: 'none' })
  })

  it('ne rend rien pour une session échue', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await sql`UPDATE operator_sessions SET expires_at = now() - interval '1 minute'`

    expect(await readSession(db, sessionId)).toEqual({ status: 'none' })
  })

  it('ne rend rien après une trop longue inactivité', async () => {
    // La durée absolue ne suffit pas : un cookie volé sur un poste laissé sans surveillance doit
    // cesser de valoir quelque chose bien avant la fin de la journée.
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)
    await sql`UPDATE operator_sessions SET last_seen_at = now() - interval '3 hours'`

    expect(await readSession(db, sessionId)).toEqual({ status: 'none' })
  })

  it('ne rend rien quand l opérateur a été désactivé', async () => {
    // **Le test qui compte le jour d'un départ.** Désactiver un opérateur doit le mettre dehors
    // immédiatement, sans avoir à révoquer ses sessions une par une — sinon la sécurité dépend de
    // l'endroit où le statut est vérifié, c'est-à-dire à terme de nulle part.
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)

    await sql`UPDATE operators SET status = 'disabled'`

    expect(await readSession(db, sessionId)).toEqual({ status: 'none' })
  })

  it('fait glisser une session utilisée', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)
    await sql`UPDATE operator_sessions SET last_seen_at = now() - interval '10 minutes'`

    await readSession(db, sessionId)

    const [row] = await sql<{ ecart: string }[]>`
      SELECT extract(epoch FROM now() - last_seen_at)::text AS ecart FROM operator_sessions
    `
    expect(Number(row?.ecart)).toBeLessThan(5)
  })

  it("n'écrit pas à chaque lecture", async () => {
    // Sans seuil, chaque affichage d'écran écrirait une ligne : cette table deviendrait le point
    // chaud du tableau de bord pour une précision dont personne n'a besoin.
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)
    const [avant] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM last_seen_at)::text AS epoch FROM operator_sessions
    `

    await readSession(db, sessionId)

    const [apres] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM last_seen_at)::text AS epoch FROM operator_sessions
    `
    expect(apres?.epoch).toBe(avant?.epoch)
  })
})

describe('révocation', () => {
  it('ferme toutes les sessions d un opérateur d un coup', async () => {
    // Le geste du jour où l'on désactive quelqu'un ou où l'on soupçonne un vol de cookie.
    const premiere = await openPendingSession(db, operatorId)
    const seconde = await openPendingSession(db, operatorId)

    expect(await revokeAllSessionsOf(db, operatorId)).toBe(2)
    expect((await readSession(db, premiere.sessionId)).status).toBe('none')
    expect((await readSession(db, seconde.sessionId)).status).toBe('none')
  })

  it('ne recompte pas une session déjà révoquée', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await revokeSession(db, sessionId)

    expect(await revokeAllSessionsOf(db, operatorId)).toBe(0)
  })

  it('est visible depuis une autre connexion, sans cache à invalider', async () => {
    // **L'exigence du périmètre** : la révocation doit être immédiate y compris pour les autres
    // instances. L'état vivant en base, une seconde connexion la constate sans qu'on lui dise rien.
    const autre = connect(container.getConnectionUri(), { poolSize: 2 })
    try {
      const { sessionId } = await openPendingSession(db, operatorId)
      await completeMfa(db, sessionId)
      expect((await readSession(autre.db, sessionId)).status).toBe('active')

      await revokeSession(db, sessionId)

      expect((await readSession(autre.db, sessionId)).status).toBe('none')
    } finally {
      await autre.client.end({ timeout: 5 })
    }
  })
})

describe('purge', () => {
  it('retire les sessions mortes depuis longtemps', async () => {
    await openPendingSession(db, operatorId)
    await sql`UPDATE operator_sessions SET expires_at = now() - interval '60 days'`

    expect(await purgeDeadSessions(db)).toBe(1)
  })

  it('garde une session révoquée récemment, que l audit peut encore citer', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await revokeSession(db, sessionId)

    expect(await purgeDeadSessions(db)).toBe(0)
  })

  it('garde une session vivante', async () => {
    await openPendingSession(db, operatorId)

    expect(await purgeDeadSessions(db)).toBe(0)
  })
})
