/**
 * Les passkeys de bout en bout côté serveur, contre un vrai PostgreSQL **et** de vraies cérémonies.
 *
 * L'authentificateur est logiciel (`src/test/webauthn-authenticator.ts`) mais ses signatures sont
 * réelles : la bibliothèque les vérifie pour de bon. C'est ce qui permet de mentir délibérément — signer
 * pour une autre origine, rejouer un défi, faire stagner le compteur — et de constater le refus.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSoftwareAuthenticator } from '../../test/webauthn-authenticator'
import { connect, type Database } from '../db/index'
import type { AuthenticatedSession, PendingSession } from './mfa'
import {
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listPasskeys,
  renamePasskey,
  revokePasskey,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from './mfa-webauthn'
import { hashPassword } from './password'
import { completeMfa, openPendingSession, readSession } from './session'
import { THRESHOLDS } from './throttle'
import { readWebAuthnConfig } from './webauthn'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const
const CONFIG = readWebAuthnConfig({
  AUTH_WEBAUTHN_RP_ID: 'localhost',
  AUTH_WEBAUTHN_ORIGIN: 'http://localhost:3000',
})

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
  await sql`DELETE FROM login_attempts`
  await sql`DELETE FROM operators`
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES ('operatrice@example.test', 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  operatorId = row?.id ?? ''
})

async function pendingSession(): Promise<PendingSession> {
  const { sessionId } = await openPendingSession(db, operatorId)
  return { status: 'pending_mfa', sessionId, operatorId }
}

async function activeSession(): Promise<AuthenticatedSession> {
  const { sessionId } = await openPendingSession(db, operatorId)
  await completeMfa(db, sessionId)
  return { status: 'active', sessionId, operatorId }
}

/** Enrôle une passkey et rend l'authentificateur qui la porte. */
async function enrollPasskey(session: AuthenticatedSession, name = 'poste') {
  const authenticator = createSoftwareAuthenticator()
  const started = await startPasskeyRegistration(db, CONFIG, session)
  if (started.outcome !== 'started') throw new Error("L'enregistrement n'a pas démarré.")

  const response = authenticator.register({
    challenge: started.options.challenge,
    rpId: CONFIG.rpId,
    origin: CONFIG.origin,
  })
  const finished = await finishPasskeyRegistration(db, CONFIG, session, response, name)
  if (finished.outcome !== 'registered') throw new Error("L'enregistrement n'a pas abouti.")

  return authenticator
}

describe('enregistrement', () => {
  it('enrôle une passkey depuis une session partielle quand aucun facteur existe', async () => {
    // Le premier enrôlement : il n'y a pas d'autre chemin, et exiger un facteur pour en créer un
    // premier n'ouvrirait jamais la porte.
    const session = await pendingSession()

    const authenticator = await enrollPasskey(session)

    const stored = await listPasskeys(db, session)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: authenticator.credentialId, name: 'poste' })
  })

  it('promeut la session : la cérémonie prouve la détention', async () => {
    const session = await pendingSession()

    await enrollPasskey(session)

    expect((await readSession(db, session.sessionId)).status).toBe('active')
  })

  it("refuse une session partielle dès qu'un facteur existe", async () => {
    // **La garde qui compte.** Sans elle, un mot de passe volé suffirait à ajouter une passkey
    // d'attaquant, donc à contourner le second facteur sans jamais le présenter.
    await enrollPasskey(await activeSession())

    expect((await startPasskeyRegistration(db, CONFIG, await pendingSession())).outcome).toBe(
      'mfa_required',
    )
  })

  it('accepte une session complète pour ajouter un second appareil', async () => {
    // Ajouter est **additif**, contrairement au réenrôlement d'un TOTP qui remplace le seul secret :
    // détenir déjà un facteur suffit à en ajouter un autre.
    const session = await activeSession()
    await enrollPasskey(session, 'poste')

    await enrollPasskey(session, 'téléphone')

    expect((await listPasskeys(db, session)).map((entry) => entry.name).sort()).toEqual([
      'poste',
      'téléphone',
    ])
  })

  it('refuse une réponse signée pour une autre origine', async () => {
    // La résistance au hameçonnage, vérifiée par une vraie signature : l'authentificateur signe pour
    // le site de l'attaquant, et le serveur le voit.
    const session = await pendingSession()
    const authenticator = createSoftwareAuthenticator()
    const started = await startPasskeyRegistration(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error("L'enregistrement n'a pas démarré.")

    const response = authenticator.register({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: 'https://hameconnage.test',
    })

    expect((await finishPasskeyRegistration(db, CONFIG, session, response, 'x')).outcome).toBe(
      'invalid_response',
    )
    expect(await listPasskeys(db, session)).toEqual([])
  })

  it('refuse un défi rejoué', async () => {
    const session = await pendingSession()
    const authenticator = createSoftwareAuthenticator()
    const started = await startPasskeyRegistration(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error("L'enregistrement n'a pas démarré.")

    const response = authenticator.register({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
    })
    expect((await finishPasskeyRegistration(db, CONFIG, session, response, 'x')).outcome).toBe(
      'registered',
    )

    // La session est relue, comme le fait la coquille HTTP à chaque requête : elle est désormais
    // complète, donc la garde d'ajout la laisse passer. Ce qui l'arrête est le **défi**, consommé au
    // premier appel — c'est bien lui que ce test isole.
    const promoted: AuthenticatedSession = {
      status: 'active',
      sessionId: session.sessionId,
      operatorId,
    }

    expect((await finishPasskeyRegistration(db, CONFIG, promoted, response, 'x')).outcome).toBe(
      'no_pending_ceremony',
    )
  })

  it("refuse d'achever une cérémonie jamais démarrée", async () => {
    const session = await pendingSession()
    const authenticator = createSoftwareAuthenticator()
    const response = authenticator.register({
      challenge: 'un-defi-jamais-emis',
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
    })

    expect((await finishPasskeyRegistration(db, CONFIG, session, response, 'x')).outcome).toBe(
      'no_pending_ceremony',
    )
  })
})

describe('authentification', () => {
  it('promeut une session partielle sur une cérémonie valide', async () => {
    const authenticator = await enrollPasskey(await activeSession())
    const session = await pendingSession()

    const started = await startPasskeyAuthentication(db, CONFIG, session)
    expect(started.outcome).toBe('started')
    if (started.outcome !== 'started') return

    const assertion = authenticator.authenticate({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
      counter: 1,
    })

    expect(await finishPasskeyAuthentication(db, CONFIG, session, assertion)).toEqual({
      outcome: 'completed',
    })
    expect((await readSession(db, session.sessionId)).status).toBe('active')
  })

  it("annonce l'absence de passkey plutôt qu'un échec", async () => {
    // L'interface doit alors proposer le TOTP : un refus indifférencié la laisserait sans conduite à
    // tenir.
    expect((await startPasskeyAuthentication(db, CONFIG, await pendingSession())).outcome).toBe(
      'no_passkey',
    )
  })

  it('refuse un compteur qui ne progresse pas', async () => {
    // La détection de clonage : un authentificateur dupliqué finit par présenter une valeur qui
    // n'avance plus. Vérifier sans conserver ne comparerait jamais rien.
    const authenticator = await enrollPasskey(await activeSession())

    const first = await pendingSession()
    const startedFirst = await startPasskeyAuthentication(db, CONFIG, first)
    if (startedFirst.outcome !== 'started') throw new Error('Cérémonie non démarrée.')
    await finishPasskeyAuthentication(
      db,
      CONFIG,
      first,
      authenticator.authenticate({
        challenge: startedFirst.options.challenge,
        rpId: CONFIG.rpId,
        origin: CONFIG.origin,
        counter: 7,
      }),
    )

    const second = await pendingSession()
    const startedSecond = await startPasskeyAuthentication(db, CONFIG, second)
    if (startedSecond.outcome !== 'started') throw new Error('Cérémonie non démarrée.')

    const stale = await finishPasskeyAuthentication(
      db,
      CONFIG,
      second,
      authenticator.authenticate({
        challenge: startedSecond.options.challenge,
        rpId: CONFIG.rpId,
        origin: CONFIG.origin,
        counter: 7,
      }),
    )

    expect(stale).toEqual({ outcome: 'invalid_response' })
    expect((await readSession(db, second.sessionId)).status).toBe('pending_mfa')
  })

  it('refuse une réponse signée pour une autre origine', async () => {
    const authenticator = await enrollPasskey(await activeSession())
    const session = await pendingSession()
    const started = await startPasskeyAuthentication(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')

    const assertion = authenticator.authenticate({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: 'https://hameconnage.test',
      counter: 1,
    })

    expect(await finishPasskeyAuthentication(db, CONFIG, session, assertion)).toEqual({
      outcome: 'invalid_response',
    })
  })

  it('refuse un appareil qui n’est pas enrôlé, comme une signature invalide', async () => {
    // Distinguer dirait à qui présente une passkey volée si elle est connue ici.
    await enrollPasskey(await activeSession())
    const intruder = createSoftwareAuthenticator()
    const session = await pendingSession()
    const started = await startPasskeyAuthentication(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')

    const assertion = intruder.authenticate({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
      counter: 1,
    })

    expect(await finishPasskeyAuthentication(db, CONFIG, session, assertion)).toEqual({
      outcome: 'invalid_response',
    })
  })

  it('verrouille après cinq échecs, comme la vérification TOTP', async () => {
    const authenticator = await enrollPasskey(await activeSession())
    await sql`DELETE FROM login_attempts`

    for (let attempt = 0; attempt < THRESHOLDS.mfa; attempt += 1) {
      const session = await pendingSession()
      const started = await startPasskeyAuthentication(db, CONFIG, session)
      if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')
      await finishPasskeyAuthentication(
        db,
        CONFIG,
        session,
        authenticator.authenticate({
          challenge: started.options.challenge,
          rpId: CONFIG.rpId,
          origin: 'https://hameconnage.test',
          counter: attempt + 1,
        }),
      )
    }

    expect((await startPasskeyAuthentication(db, CONFIG, await pendingSession())).outcome).toBe(
      'rate_limited',
    )
  })
})

describe('révocation', () => {
  it('refuse de retirer le dernier facteur', async () => {
    // Sans cette garde, un opérateur se met dehors en un clic et seule une intervention en base le
    // remet.
    const session = await activeSession()
    const authenticator = await enrollPasskey(session)

    expect(await revokePasskey(db, session, authenticator.credentialId)).toEqual({
      outcome: 'last_factor',
    })
    expect(await listPasskeys(db, session)).toHaveLength(1)
  })

  it("accepte de retirer une passkey s'il en reste une autre", async () => {
    const session = await activeSession()
    const first = await enrollPasskey(session, 'poste')
    await enrollPasskey(session, 'téléphone')

    const revoked = await revokePasskey(db, session, first.credentialId)

    expect(revoked.outcome).toBe('revoked')
    expect((await listPasskeys(db, session)).map((entry) => entry.name)).toEqual(['téléphone'])
  })

  it('accepte de retirer la dernière passkey si un TOTP reste actif', async () => {
    const session = await activeSession()
    const authenticator = await enrollPasskey(session)
    await sql`UPDATE operators SET mfa_totp_secret = 'v1.peu-importe', mfa_totp_activated_at = now()
              WHERE id = ${operatorId}`

    expect((await revokePasskey(db, session, authenticator.credentialId)).outcome).toBe('revoked')
    expect(await listPasskeys(db, session)).toEqual([])
  })

  it('refuse de retirer un appareil inconnu', async () => {
    const session = await activeSession()
    await enrollPasskey(session)

    expect((await revokePasskey(db, session, 'cred-absent')).outcome).toBe('unknown_credential')
  })
})

describe('ce que la liste expose', () => {
  it('ne porte ni clé publique ni compteur', async () => {
    // Aucune n'est un secret — la clé est publique par construction — mais rien dans l'interface n'en
    // a besoin, et une donnée qui ne sort pas ne peut pas être recopiée dans un journal.
    const session = await activeSession()
    await enrollPasskey(session)

    const [entry] = await listPasskeys(db, session)

    expect(Object.keys(entry ?? {}).sort()).toEqual(['createdAt', 'id', 'name'])
  })
})

describe('renommage', () => {
  it('renomme un appareil et rend la liste à jour', async () => {
    // Le nom vient de l'opérateur : c'est ce qui rend une liste de trois appareils exploitable au
    // moment d'en retirer un.
    const session = await activeSession()
    const authenticator = await enrollPasskey(session, 'poste')

    const renamed = await renamePasskey(
      db,
      session,
      authenticator.credentialId,
      'MacBook du bureau',
    )

    expect(renamed.outcome).toBe('revoked')
    expect((await listPasskeys(db, session)).map((entry) => entry.name)).toEqual([
      'MacBook du bureau',
    ])
  })

  it('refuse de renommer un appareil inconnu', async () => {
    const session = await activeSession()
    await enrollPasskey(session)

    expect((await renamePasskey(db, session, 'cred-absent', 'x')).outcome).toBe(
      'unknown_credential',
    )
  })
})

describe('chemins de refus restants', () => {
  it("refuse d'achever un enregistrement depuis une session partielle quand un facteur existe", async () => {
    // La garde est évaluée aux **deux** phases : la contourner en n'appelant que la seconde ne doit
    // pas marcher.
    const session = await activeSession()
    const authenticator = createSoftwareAuthenticator()
    const started = await startPasskeyRegistration(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')
    await enrollPasskey(session, 'déjà là')

    const response = authenticator.register({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
    })
    const partial: PendingSession = {
      status: 'pending_mfa',
      sessionId: session.sessionId,
      operatorId,
    }

    expect((await finishPasskeyRegistration(db, CONFIG, partial, response, 'x')).outcome).toBe(
      'mfa_required',
    )
  })

  it('refuse un appareil déjà enrôlé', async () => {
    // Le même authentificateur, deux cérémonies : `excludeCredentials` le dit au navigateur, et le
    // magasin le refuse quand le navigateur ne l'écoute pas.
    const session = await activeSession()
    const authenticator = await enrollPasskey(session)

    const started = await startPasskeyRegistration(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')
    const response = authenticator.register({
      challenge: started.options.challenge,
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
    })

    expect((await finishPasskeyRegistration(db, CONFIG, session, response, 'x')).outcome).toBe(
      'invalid_response',
    )
    expect(await listPasskeys(db, session)).toHaveLength(1)
  })

  it("refuse d'achever une authentification sans cérémonie en cours", async () => {
    const authenticator = await enrollPasskey(await activeSession())
    const session = await pendingSession()

    const assertion = authenticator.authenticate({
      challenge: 'un-defi-jamais-emis',
      rpId: CONFIG.rpId,
      origin: CONFIG.origin,
      counter: 1,
    })

    expect(await finishPasskeyAuthentication(db, CONFIG, session, assertion)).toEqual({
      outcome: 'no_pending_ceremony',
    })
  })

  it('refuse une authentification quand le compteur a fermé la porte', async () => {
    const authenticator = await enrollPasskey(await activeSession())
    const session = await pendingSession()
    const started = await startPasskeyAuthentication(db, CONFIG, session)
    if (started.outcome !== 'started') throw new Error('Cérémonie non démarrée.')

    for (let attempt = 0; attempt < THRESHOLDS.mfa; attempt += 1) {
      await sql`INSERT INTO login_attempts (scope, subject, failures, locked_until)
                VALUES ('mfa', ${operatorId}, 99, now() + interval '15 minutes')
                ON CONFLICT (scope, subject) DO UPDATE SET locked_until = now() + interval '15 minutes'`
    }

    const outcome = await finishPasskeyAuthentication(
      db,
      CONFIG,
      session,
      authenticator.authenticate({
        challenge: started.options.challenge,
        rpId: CONFIG.rpId,
        origin: CONFIG.origin,
        counter: 1,
      }),
    )

    expect(outcome.outcome).toBe('rate_limited')
    if (outcome.outcome !== 'rate_limited') return
    expect(outcome.retryAfterSeconds).toBeGreaterThan(0)
  })
})
