/** Le cycle de vie des sessions, contre un vrai PostgreSQL : c'est la base qui fait autorité. */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { lockHolder, waitUntilBlocked } from '../../test/pg-locks'
import { connect, type Database } from '../db/index'
import { SESSION_COOKIE_NAME, signSessionId } from './cookie'
import { resolveSession } from './guard'
import { currentOperator } from './me'
import { hashPassword } from './password'
import {
  completeMfa,
  consumeWebAuthnChallenge,
  endSession,
  issueWebAuthnChallenge,
  openPendingSession,
  purgeDeadSessions,
  readSession,
  revokeAllSessionsOf,
  revokeSession,
} from './session'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const

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
    VALUES ('operateur@example.test', 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
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
    const [before] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM mfa_completed_at)::text AS epoch FROM operator_sessions
    `

    await completeMfa(db, sessionId)

    const [after] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM mfa_completed_at)::text AS epoch FROM operator_sessions
    `
    expect(after?.epoch).toBe(before?.epoch)
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
    const [before] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM last_seen_at)::text AS epoch FROM operator_sessions
    `

    await readSession(db, sessionId)

    const [after] = await sql<{ epoch: string }[]>`
      SELECT extract(epoch FROM last_seen_at)::text AS epoch FROM operator_sessions
    `
    expect(after?.epoch).toBe(before?.epoch)
  })
})

describe('révocation', () => {
  it('ferme toutes les sessions d un opérateur d un coup', async () => {
    // Le geste du jour où l'on désactive quelqu'un ou où l'on soupçonne un vol de cookie.
    const first = await openPendingSession(db, operatorId)
    const second = await openPendingSession(db, operatorId)

    expect(await revokeAllSessionsOf(db, operatorId)).toBe(2)
    expect((await readSession(db, first.sessionId)).status).toBe('none')
    expect((await readSession(db, second.sessionId)).status).toBe('none')
  })

  it('ferme une session partielle comme une autre', async () => {
    // Abandonner un second facteur en cours doit fermer ce qui a été ouvert : sinon la session
    // partielle traînerait jusqu'à son expiration, et le cookie avec elle.
    const { sessionId } = await openPendingSession(db, operatorId)

    await endSession(db, await readSession(db, sessionId))

    expect((await readSession(db, sessionId)).status).toBe('none')
  })

  it('ne fait rien quand il n y a pas de session', async () => {
    // Le cas d'une déconnexion sans cookie : elle doit aboutir sans rien révoquer, parce que la
    // réponse ne dira pas non plus s'il y avait quelque chose à fermer.
    await expect(endSession(db, { status: 'none' })).resolves.toBeUndefined()
  })

  it('ne recompte pas une session déjà révoquée', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await revokeSession(db, sessionId)

    expect(await revokeAllSessionsOf(db, operatorId)).toBe(0)
  })

  it('est visible depuis une autre connexion, sans cache à invalider', async () => {
    // **L'exigence du périmètre** : la révocation doit être immédiate y compris pour les autres
    // instances. L'état vivant en base, une seconde connexion la constate sans qu'on lui dise rien.
    const other = connect(container.getConnectionUri(), { poolSize: 2 })
    try {
      const { sessionId } = await openPendingSession(db, operatorId)
      await completeMfa(db, sessionId)
      expect((await readSession(other.db, sessionId)).status).toBe('active')

      await revokeSession(db, sessionId)

      expect((await readSession(other.db, sessionId)).status).toBe('none')
    } finally {
      await other.client.end({ timeout: 5 })
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
  const cookieHeader = (value: string) => `theme=sombre; ${SESSION_COOKIE_NAME}=${value}`

  it('résout un cookie signé jusqu à la session', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await completeMfa(db, sessionId)

    const state = await resolveSession(db, cookieHeader(signSessionId(sessionId, SECRETS)), SECRETS)

    expect(state).toEqual({ status: 'active', sessionId, operatorId })
  })

  it('refuse un identifiant valide dont la signature vient d une autre clé', async () => {
    // Sans la signature, connaître un identifiant suffirait à prendre la session.
    const { sessionId } = await openPendingSession(db, operatorId)
    const other = { current: 'une-tout-autre-cle-de-session-assez-longue' }

    expect(
      await resolveSession(db, cookieHeader(signSessionId(sessionId, other)), SECRETS),
    ).toEqual({
      status: 'none',
    })
  })

  it('refuse un identifiant correctement signé mais révoqué', async () => {
    // **La signature dit « nous avons émis ceci », la base dit « ceci vaut encore ».** Les deux sont
    // nécessaires : sans la seconde, une déconnexion ne déconnecterait rien.
    const { sessionId } = await openPendingSession(db, operatorId)
    const cookie = cookieHeader(signSessionId(sessionId, SECRETS))
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

describe('défi WebAuthn porté par la session', () => {
  it('rend le défi émis, une fois et une seule', async () => {
    // **L'usage unique est la propriété qui compte.** Un défi rejouable rendrait la cérémonie
    // rejouable, et c'est précisément ce que WebAuthn existe pour empêcher.
    const { sessionId } = await openPendingSession(db, operatorId)
    await issueWebAuthnChallenge(db, sessionId, 'un-defi-en-base64url')

    expect(await consumeWebAuthnChallenge(db, sessionId)).toBe('un-defi-en-base64url')
    expect(await consumeWebAuthnChallenge(db, sessionId)).toBeUndefined()
  })

  it("ne rend rien quand aucun défi n'a été émis", async () => {
    const { sessionId } = await openPendingSession(db, operatorId)

    expect(await consumeWebAuthnChallenge(db, sessionId)).toBeUndefined()
  })

  it('remplace un défi précédent plutôt que de les accumuler', async () => {
    // Recommencer une cérémonie est ordinaire — l'opérateur ferme la fenêtre du navigateur. Le
    // premier défi doit cesser de valoir quelque chose, sinon deux cérémonies restent ouvertes.
    const { sessionId } = await openPendingSession(db, operatorId)
    await issueWebAuthnChallenge(db, sessionId, 'le-premier')
    await issueWebAuthnChallenge(db, sessionId, 'le-second')

    expect(await consumeWebAuthnChallenge(db, sessionId)).toBe('le-second')
  })

  it('ne rend pas un défi périmé', async () => {
    const { sessionId } = await openPendingSession(db, operatorId)
    await issueWebAuthnChallenge(db, sessionId, 'trop-vieux')
    await sql`UPDATE operator_sessions SET webauthn_challenge_expires_at = now() - interval '1 second'
              WHERE id = ${sessionId}`

    expect(await consumeWebAuthnChallenge(db, sessionId)).toBeUndefined()
  })

  it("ne rend pas le défi d'une autre session", async () => {
    // Le défi est lié à la session qui l'a demandé : sans cela, une cérémonie commencée ici pourrait
    // être achevée ailleurs.
    const mine = await openPendingSession(db, operatorId)
    const other = await openPendingSession(db, operatorId)
    await issueWebAuthnChallenge(db, mine.sessionId, 'le-mien')

    expect(await consumeWebAuthnChallenge(db, other.sessionId)).toBeUndefined()
    expect(await consumeWebAuthnChallenge(db, mine.sessionId)).toBe('le-mien')
  })

  it('refuse un défi à qui a lu la ligne avant sa consommation', async () => {
    // **Le test qui justifie le `FOR UPDATE`, et il a fallu le forcer.** Un `Promise.all` sur deux
    // pools ne prouve rien ici : les deux appels ne se chevauchent presque jamais, le second part
    // après que le premier a validé, et il voit donc un défi déjà remis à `NULL`. Vérifié par
    // mutation — le verrou retiré, cette version-là passait encore.
    //
    // L'entrelacement est donc construit : une transaction tient le verrou de la ligne, le second
    // appelant s'y bloque — on l'observe dans `pg_locks`, pas par une attente arbitraire — puis la
    // première consomme le défi et valide. Sans `FOR UPDATE`, le second aurait déjà lu la valeur
    // dans son propre instantané et la rendrait malgré tout.
    const { sessionId } = await openPendingSession(db, operatorId)
    await issueWebAuthnChallenge(db, sessionId, 'disputé')

    const other = connect(container.getConnectionUri(), { poolSize: 2 })
    const lock = lockHolder()

    try {
      const holder = sql.begin(async (tx) => {
        await tx`SELECT id FROM operator_sessions WHERE id = ${sessionId} FOR UPDATE`
        lock.signalAcquired()
        await lock.held
        await tx`UPDATE operator_sessions SET webauthn_challenge = NULL WHERE id = ${sessionId}`
      })

      // Le rival n'est armé **qu'après** le signal : sans cet ordre, il peut prendre et relâcher le
      // verrou avant que le détenteur ne l'ait demandé, et rien ne se bloque jamais.
      await lock.acquired
      const contender = consumeWebAuthnChallenge(other.db, sessionId)
      await waitUntilBlocked(sql)
      lock.release()
      await holder

      expect(await contender).toBeUndefined()
    } finally {
      lock.release()
      await other.client.end({ timeout: 5 })
    }
  })
})
