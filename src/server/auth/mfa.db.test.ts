/**
 * L'enrôlement et la vérification du second facteur, contre un vrai PostgreSQL.
 *
 * Trois propriétés de cette step ne se prouvent que là : le secret est **chiffré** dans la colonne,
 * l'anti-rejeu tient **entre instances**, et un code de récupération ne vaut **qu'une fois**. Les
 * trois sont des faits de la base, pas des branches de TypeScript.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Database } from '../db/index'
import { currentOperator } from './me'
import { confirmTotpEnrollment, startTotpEnrollment, verifyMfaCode } from './mfa'
import { countUnusedRecoveryCodes, RECOVERY_CODE_COUNT } from './mfa-recovery'
import { openTotpSecret, readMfaKeys } from './mfa-secret'
import { TOTP_PERIOD_SECONDS, totpCodeAt } from './mfa-totp'
import { hashPassword } from './password'
import { openPendingSession, readSession, type SessionState } from './session'
import { THRESHOLDS } from './throttle'

const POSTGRES_IMAGE = 'postgres:18-alpine'
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const
const KEYS = readMfaKeys({ AUTH_MFA_SECRET: 'une-cle-mfa-de-test-suffisamment-longue-pour' })
const EMAIL = 'operatrice@example.test'

/** Un instant fixe : les codes TOTP dépendent de l'horloge, les tests ne doivent pas en dépendre. */
const NOW = new Date('2026-07-29T12:00:00.000Z')
const later = (steps: number) => new Date(NOW.getTime() + steps * TOTP_PERIOD_SECONDS * 1000)

let container: StartedPostgreSqlContainer
let sql: postgres.Sql
let db: Database
/** Un second pool : deux instances de la console, et non deux requêtes du même process. */
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
  await sql`DELETE FROM login_attempts`
  await sql`DELETE FROM operators`
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO operators (email, display_name, password_hash)
    VALUES (${EMAIL}, 'Opératrice', ${await hashPassword('un mot de passe long', FAST_SCRYPT)})
    RETURNING id::text
  `
  operatorId = row?.id ?? ''
})

/** Une session partielle, telle que la connexion par mot de passe en ouvre une. */
async function pendingSession(
  database: Database = db,
): Promise<Extract<SessionState, { status: 'pending_mfa' }>> {
  const { sessionId } = await openPendingSession(database, operatorId)
  return { status: 'pending_mfa', sessionId, operatorId }
}

/** Enrôle un second facteur et rend le secret en clair, comme l'opérateur l'a scanné. */
async function enroll(): Promise<string> {
  const started = await startTotpEnrollment(db, KEYS, await pendingSession())
  if (started.outcome !== 'started') throw new Error("L'enrôlement n'a pas démarré.")

  const session = await pendingSession()
  const code = await totpCodeAt(started.secret, NOW)
  const confirmed = await confirmTotpEnrollment(db, KEYS, session, code, NOW)
  if (confirmed.outcome !== 'activated') throw new Error("L'enrôlement n'a pas été confirmé.")

  return started.secret
}

describe("démarrage de l'enrôlement", () => {
  it("rend un secret et l'URI que scanne l'application", async () => {
    const started = await startTotpEnrollment(db, KEYS, await pendingSession())

    expect(started).toMatchObject({ outcome: 'started' })
    if (started.outcome !== 'started') return
    expect(started.uri).toContain(`secret=${started.secret}`)
    expect(decodeURIComponent(started.uri)).toContain(EMAIL)
  })

  it('stocke le secret chiffré, jamais en clair', async () => {
    const started = await startTotpEnrollment(db, KEYS, await pendingSession())
    if (started.outcome !== 'started') throw new Error("L'enrôlement n'a pas démarré.")

    const [row] = await sql<{ mfa_totp_secret: string }[]>`
      SELECT mfa_totp_secret FROM operators WHERE id = ${operatorId}
    `
    expect(row?.mfa_totp_secret).not.toContain(started.secret)
    expect(openTotpSecret(row?.mfa_totp_secret ?? '', operatorId, KEYS)).toBe(started.secret)
  })

  it("n'active rien tant qu'un premier code n'a pas été présenté", async () => {
    // Un secret écrit ne veut pas dire un facteur détenu : l'application n'a peut-être jamais scanné
    // le QR code. Activer ici enfermerait l'opérateur dehors.
    await startTotpEnrollment(db, KEYS, await pendingSession())

    const [row] = await sql<{ mfa_totp_activated_at: string | null }[]>`
      SELECT mfa_totp_activated_at FROM operators WHERE id = ${operatorId}
    `
    expect(row?.mfa_totp_activated_at).toBeNull()
  })

  it('remplace un enrôlement commencé mais jamais confirmé', async () => {
    // Le cas ordinaire : l'opérateur ferme l'onglet et recommence. Refuser ici le bloquerait sans
    // qu'aucun facteur n'existe.
    const first = await startTotpEnrollment(db, KEYS, await pendingSession())
    const second = await startTotpEnrollment(db, KEYS, await pendingSession())

    expect(second.outcome).toBe('started')
    if (first.outcome !== 'started' || second.outcome !== 'started') return
    expect(second.secret).not.toBe(first.secret)
  })

  it('refuse de remplacer un facteur déjà actif', async () => {
    // **La garde qui compte.** Une session partielle ne porte qu'un mot de passe : si elle pouvait
    // réenrôler, un mot de passe volé suffirait à substituer le second facteur, donc à l'annuler.
    await enroll()

    expect((await startTotpEnrollment(db, KEYS, await pendingSession())).outcome).toBe(
      'already_enrolled',
    )
  })
})

describe("confirmation de l'enrôlement", () => {
  it('active le facteur, rend les codes de récupération et promeut la session', async () => {
    const started = await startTotpEnrollment(db, KEYS, await pendingSession())
    if (started.outcome !== 'started') throw new Error("L'enrôlement n'a pas démarré.")
    const session = await pendingSession()

    const confirmed = await confirmTotpEnrollment(
      db,
      KEYS,
      session,
      await totpCodeAt(started.secret, NOW),
      NOW,
    )

    expect(confirmed.outcome).toBe('activated')
    if (confirmed.outcome !== 'activated') return
    expect(confirmed.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT)
    // La confirmation est une vérification comme une autre : exiger un second code trente secondes
    // plus tard n'ajouterait rien à ce qui vient d'être prouvé.
    expect((await readSession(db, session.sessionId)).status).toBe('active')
  })

  it("n'active pas sur un code faux", async () => {
    await startTotpEnrollment(db, KEYS, await pendingSession())
    const session = await pendingSession()

    expect((await confirmTotpEnrollment(db, KEYS, session, '000000', NOW)).outcome).toBe(
      'invalid_code',
    )
    expect((await readSession(db, session.sessionId)).status).toBe('pending_mfa')
  })

  it("refuse quand aucun enrôlement n'est en cours", async () => {
    const session = await pendingSession()

    expect((await confirmTotpEnrollment(db, KEYS, session, '000000', NOW)).outcome).toBe(
      'no_pending_enrollment',
    )
  })

  it('interdit de confirmer deux fois', async () => {
    const secret = await enroll()
    const session = await pendingSession()

    const again = await confirmTotpEnrollment(
      db,
      KEYS,
      session,
      await totpCodeAt(secret, later(2)),
      later(2),
    )

    expect(again.outcome).toBe('no_pending_enrollment')
  })

  it("n'active le facteur qu'une fois quand deux instances confirment ensemble", async () => {
    // Deux onglets, ou deux instances, qui confirment le même enrôlement. Sans le `WHERE` conditionnel
    // de l'activation, la seconde régénérerait un lot de codes de récupération — donc invaliderait
    // celui que l'opérateur vient de noter, sans qu'aucune des deux réponses ne le dise.
    const started = await startTotpEnrollment(db, KEYS, await pendingSession())
    if (started.outcome !== 'started') throw new Error("L'enrôlement n'a pas démarré.")
    const code = await totpCodeAt(started.secret, NOW)

    const outcomes = await Promise.all([
      confirmTotpEnrollment(db, KEYS, await pendingSession(), code, NOW),
      confirmTotpEnrollment(otherInstance, KEYS, await pendingSession(otherInstance), code, NOW),
    ])

    expect(outcomes.filter((result) => result.outcome === 'activated')).toHaveLength(1)
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT)
  })

  it("renvoie au démarrage quand l'enveloppe est devenue illisible", async () => {
    // Le cas d'exploitation : la clé a changé entre le démarrage et la confirmation. On ne laisse pas
    // l'opérateur taper un code juste indéfiniment — on lui dit de relancer l'enrôlement, ce qui
    // remplacera l'enveloppe.
    await startTotpEnrollment(db, KEYS, await pendingSession())
    await sql`UPDATE operators SET mfa_totp_secret = 'v1.illisible' WHERE id = ${operatorId}`

    const confirmed = await confirmTotpEnrollment(db, KEYS, await pendingSession(), '000000', NOW)

    expect(confirmed.outcome).toBe('no_pending_enrollment')
  })

  it('est soumise au même plafond de tentatives que la vérification', async () => {
    // Sans cela, la confirmation d'enrôlement serait un second point de devinette, sans plafond, sur
    // le même code à six chiffres.
    await startTotpEnrollment(db, KEYS, await pendingSession())
    for (let attempt = 0; attempt < THRESHOLDS.mfa; attempt += 1) {
      await confirmTotpEnrollment(db, KEYS, await pendingSession(), '000000', NOW)
    }

    const confirmed = await confirmTotpEnrollment(db, KEYS, await pendingSession(), '000000', NOW)

    expect(confirmed.outcome).toBe('rate_limited')
    if (confirmed.outcome !== 'rate_limited') return
    expect(confirmed.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('vérification du second facteur', () => {
  let secret: string

  beforeEach(async () => {
    secret = await enroll()
    await sql`DELETE FROM login_attempts`
  })

  it('promeut la session sur un code valide', async () => {
    const session = await pendingSession()

    const result = await verifyMfaCode(
      db,
      KEYS,
      session,
      await totpCodeAt(secret, later(2)),
      later(2),
    )

    expect(result).toEqual({ outcome: 'completed' })
    expect((await readSession(db, session.sessionId)).status).toBe('active')
  })

  it('donne alors ses permissions à /auth/me', async () => {
    // Le bout du fil : une session partielle ne porte aucune permission, une session complète les
    // résout. C'est ce que l'écran de login attend pour se peindre (step-026).
    const session = await pendingSession()
    await verifyMfaCode(db, KEYS, session, await totpCodeAt(secret, later(2)), later(2))

    const me = await currentOperator(db, await readSession(db, session.sessionId))

    expect(me?.mfaCompleted).toBe(true)
  })

  it('refuse un code hors de la fenêtre de dérive', async () => {
    const session = await pendingSession()

    const result = await verifyMfaCode(
      db,
      KEYS,
      session,
      await totpCodeAt(secret, later(2)),
      later(6),
    )

    expect(result).toEqual({ outcome: 'invalid_code' })
    expect((await readSession(db, session.sessionId)).status).toBe('pending_mfa')
  })

  it('refuse le rejeu du même code, y compris depuis une autre instance', async () => {
    // Le cœur de l'anti-rejeu. Un code lu par-dessus une épaule, dans un journal ou sur un canal de
    // support reste valide pendant toute sa fenêtre : sans marqueur partagé, changer d'instance —
    // c'est-à-dire recharger la page — suffirait à le rejouer.
    const code = await totpCodeAt(secret, later(2))
    const first = await verifyMfaCode(db, KEYS, await pendingSession(), code, later(2))
    expect(first.outcome).toBe('completed')

    const replayed = await verifyMfaCode(
      otherInstance,
      KEYS,
      await pendingSession(otherInstance),
      code,
      later(2),
    )

    expect(replayed).toEqual({ outcome: 'invalid_code' })
  })

  it("n'accorde le même code qu'à une seule des deux instances qui le présentent", async () => {
    // **Le test qui justifie l'écriture conditionnelle.** Le cas séquentiel ci-dessus passerait encore
    // si `advanceTimeStep` devenait un `SELECT` suivi d'un `UPDATE` : deux requêtes concurrentes
    // liraient le même pas et l'écriraient toutes les deux, et le rejeu redeviendrait possible
    // exactement sous la charge où il compte.
    //
    // Deux pools distincts, donc deux backends PostgreSQL qui se disputent la ligne. L'ordre reste
    // celui de l'ordonnanceur : ce test ne prouve pas l'absence de course, il prouve que l'écriture
    // conditionnelle désigne un seul gagnant quand elle a lieu.
    const code = await totpCodeAt(secret, later(2))

    const outcomes = await Promise.all([
      verifyMfaCode(db, KEYS, await pendingSession(), code, later(2)),
      verifyMfaCode(otherInstance, KEYS, await pendingSession(otherInstance), code, later(2)),
    ])

    expect(outcomes.filter((result) => result.outcome === 'completed')).toHaveLength(1)
  })

  it('refuse un code antérieur au dernier pas consommé', async () => {
    // Le marqueur est monotone, et pas une simple égalité : accepter un pas plus ancien laisserait
    // rejouable le code voisin que la fenêtre de dérive tolère.
    await verifyMfaCode(
      db,
      KEYS,
      await pendingSession(),
      await totpCodeAt(secret, later(4)),
      later(4),
    )

    const older = await verifyMfaCode(
      db,
      KEYS,
      await pendingSession(),
      await totpCodeAt(secret, later(3)),
      later(4),
    )

    expect(older).toEqual({ outcome: 'invalid_code' })
  })

  it('accepte un code de récupération une fois, et une seule', async () => {
    const codes = await freshRecoveryCodes()
    const code = codes[0] ?? ''

    const first = await verifyMfaCode(db, KEYS, await pendingSession(), code, later(2))
    const second = await verifyMfaCode(db, KEYS, await pendingSession(), code, later(2))

    expect(first).toEqual({
      outcome: 'completed',
      recovery: { remaining: RECOVERY_CODE_COUNT - 1 },
    })
    expect(second).toEqual({ outcome: 'invalid_code' })
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT - 1)
  })

  it("verrouille après cinq échecs, et le dit puisqu'il n'y a plus rien à cacher", async () => {
    // Ce point d'entrée exige déjà une session ouverte par un mot de passe valide : celui qui reçoit
    // le refus sait que le compte existe. Lui cacher l'échéance ne le ferait que réessayer en vain.
    for (let attempt = 0; attempt < THRESHOLDS.mfa; attempt += 1) {
      await verifyMfaCode(db, KEYS, await pendingSession(), '000000', later(2))
    }

    const result = await verifyMfaCode(
      db,
      KEYS,
      await pendingSession(),
      await totpCodeAt(secret, later(2)),
      later(2),
    )

    expect(result.outcome).toBe('rate_limited')
    if (result.outcome !== 'rate_limited') return
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('efface le compteur après un succès', async () => {
    await verifyMfaCode(db, KEYS, await pendingSession(), '000000', later(2))

    await verifyMfaCode(
      db,
      KEYS,
      await pendingSession(),
      await totpCodeAt(secret, later(2)),
      later(2),
    )

    const rows = await sql`SELECT 1 FROM login_attempts WHERE scope = 'mfa'`
    expect(rows).toHaveLength(0)
  })

  it('compte le sujet en clair, pour que l’exploitation puisse lire qui est bloqué', async () => {
    await verifyMfaCode(db, KEYS, await pendingSession(), '000000', later(2))

    const [row] = await sql<{ subject: string }[]>`
      SELECT subject FROM login_attempts WHERE scope = 'mfa'
    `
    expect(row?.subject).toBe(operatorId)
  })

  it("refuse tout code quand l'enveloppe du secret est illisible", async () => {
    // Clé retirée, colonne bricolée : le refus est le même que pour un code faux. **Fermé par
    // défaut** — une enveloppe qu'on ne sait plus lire ne peut pas valoir un second facteur.
    const code = await totpCodeAt(secret, later(2))
    await sql`UPDATE operators SET mfa_totp_secret = 'v1.illisible' WHERE id = ${operatorId}`

    const result = await verifyMfaCode(db, KEYS, await pendingSession(), code, later(2))

    expect(result).toEqual({ outcome: 'invalid_code' })
  })

  it('refuse tout code quand aucun facteur n’est actif', async () => {
    await sql`UPDATE operators SET mfa_totp_activated_at = NULL WHERE id = ${operatorId}`

    const result = await verifyMfaCode(
      db,
      KEYS,
      await pendingSession(),
      await totpCodeAt(secret, later(2)),
      later(2),
    )

    expect(result).toEqual({ outcome: 'invalid_code' })
  })

  it('refuse un code de récupération quand le facteur a été réinitialisé', async () => {
    // Un code de récupération n'existe que pour rentrer quand l'appareil manque, **pas** quand le
    // facteur lui-même a été retiré. S'il y survivait, la réinitialisation d'un second facteur
    // (step-027) laisserait derrière elle dix codes qui l'ouvrent encore — c'est-à-dire qu'elle ne
    // retirerait rien du tout.
    const codes = await freshRecoveryCodes()
    await sql`UPDATE operators SET mfa_totp_activated_at = NULL WHERE id = ${operatorId}`

    const result = await verifyMfaCode(db, KEYS, await pendingSession(), codes[0] ?? '', later(2))

    expect(result).toEqual({ outcome: 'invalid_code' })
    expect(await countUnusedRecoveryCodes(db, operatorId)).toBe(RECOVERY_CODE_COUNT)
  })
})

/**
 * Les codes de récupération d'un lot fraîchement créé.
 *
 * Ils ne se relisent pas — c'est tout l'objet de l'invariant (b) — donc on refait un enrôlement
 * complet pour en obtenir un lot connu.
 */
async function freshRecoveryCodes(): Promise<readonly string[]> {
  await sql`UPDATE operators SET mfa_totp_activated_at = NULL, mfa_totp_secret = NULL WHERE id = ${operatorId}`
  const started = await startTotpEnrollment(db, KEYS, await pendingSession())
  if (started.outcome !== 'started') throw new Error("L'enrôlement n'a pas démarré.")

  const confirmed = await confirmTotpEnrollment(
    db,
    KEYS,
    await pendingSession(),
    await totpCodeAt(started.secret, NOW),
    NOW,
  )
  if (confirmed.outcome !== 'activated') throw new Error("L'enrôlement n'a pas été confirmé.")

  return confirmed.recoveryCodes
}
