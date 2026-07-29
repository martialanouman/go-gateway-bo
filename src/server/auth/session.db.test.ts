/** Le cycle de vie des sessions, contre un vrai PostgreSQL : c'est la base qui fait autorité. */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import { SESSION_COOKIE_NAME, signSessionId } from './cookie'
import { resolveSession } from './guard'
import { currentOperator } from './me'
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

  it('donne à une session partielle quelques minutes, pas la journée', async () => {
    // **La fenêtre de devinette du second facteur.** Step-023 fera valider un code à six chiffres
    // contre cette session : lui laisser le plafond d'une session complète offrirait douze heures
    // pour l'atteindre.
    await openPendingSession(db, operatorId)

    const [row] = await sql<{ minutes: string }[]>`
      SELECT extract(epoch FROM expires_at - now())::text AS minutes FROM operator_sessions
    `
    expect(Number(row?.minutes)).toBeLessThan(15 * 60)
  })

  it('repousse la fin de validité au plafond une fois le second facteur passé', async () => {
    // Le plafond court ne doit pas se payer d'une déconnexion dix minutes après la connexion : la
    // promotion est le moment où l'on sait que les deux facteurs ont été présentés.
    const { sessionId } = await openPendingSession(db, operatorId)

    await completeMfa(db, sessionId)

    const [row] = await sql<{ heures: string }[]>`
      SELECT extract(epoch FROM expires_at - now())::text AS heures FROM operator_sessions
    `
    expect(Number(row?.heures)).toBeGreaterThan(11 * 3600)
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

  it('ne fait pas glisser une session partielle', async () => {
    // Sinon le plafond court ne tiendrait pas : un onglet qui interroge `/auth/me` maintiendrait
    // ouverte, aussi longtemps qu'il veut, une session qui n'a présenté qu'un mot de passe.
    const { sessionId } = await openPendingSession(db, operatorId)
    await sql`UPDATE operator_sessions SET last_seen_at = now() - interval '5 minutes'`

    await readSession(db, sessionId)

    const [row] = await sql<{ ecart: string }[]>`
      SELECT extract(epoch FROM now() - last_seen_at)::text AS ecart FROM operator_sessions
    `
    expect(Number(row?.ecart)).toBeGreaterThan(240)
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

describe('résolution depuis un en-tête Cookie', () => {
  const SECRETS = { current: 'une-cle-de-session-de-test-assez-longue' }
  const entete = (value: string) => `theme=sombre; ${SESSION_COOKIE_NAME}=${value}`

  it('résout un cookie signé jusqu à la session', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)

    const state = await resolveSession(db, entete(signSessionId(sessionId, SECRETS)), SECRETS)

    expect(state).toEqual({ status: 'active', sessionId, operatorId })
  })

  it('refuse un identifiant valide dont la signature vient d une autre clé', async () => {
    // Sans la signature, connaître un identifiant suffirait à prendre la session.
    const { sessionId } = await openPendingSession(db, operatorId)
    const autre = { current: 'une-tout-autre-cle-de-session-assez-longue' }

    expect(await resolveSession(db, entete(signSessionId(sessionId, autre)), SECRETS)).toEqual({
      status: 'none',
    })
  })

  it('refuse un identifiant correctement signé mais révoqué', async () => {
    // **La signature dit « nous avons émis ceci », la base dit « ceci vaut encore ».** Les deux sont
    // nécessaires : sans la seconde, une déconnexion ne déconnecterait rien.
    const { sessionId } = await openPendingSession(db, operatorId)
    const cookie = entete(signSessionId(sessionId, SECRETS))
    await revokeSession(db, sessionId)

    expect(await resolveSession(db, cookie, SECRETS)).toEqual({ status: 'none' })
  })

  it('refuse une absence de cookie sans toucher la base', async () => {
    for (const header of [undefined, null, '', 'theme=sombre']) {
      expect(await resolveSession(db, header, SECRETS), JSON.stringify(header)).toEqual({
        status: 'none',
      })
    }
  })
})

describe('opérateur disparu après la lecture de session', () => {
  it('ne rend aucun opérateur courant', async () => {
    // Cas de course réel : la session est lue, puis le compte est supprimé avant la composition de
    // `/auth/me`. Rendre un opérateur vide serait pire qu'un refus.
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)
    const state = await readSession(db, sessionId)

    await sql`DELETE FROM operators WHERE id = ${operatorId}::uuid`

    expect(await currentOperator(db, state)).toBeUndefined()
  })
})
