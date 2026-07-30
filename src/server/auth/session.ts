/**
 * Le cycle de vie d'une session d'opérateur.
 *
 * L'autorité est la base, jamais le cookie : c'est ce qui rend la révocation immédiate et visible
 * depuis n'importe quelle instance. Chaque lecture revérifie donc l'état complet — session vivante,
 * opérateur actif — et rend un refus explicite plutôt qu'un `null` que l'appelant pourrait confondre
 * avec « pas encore chargé ».
 *
 * ## Deux durées, et elles ne servent pas à la même chose
 *
 * `expiresAt` est la **fin absolue** : au-delà, la session ne vaut plus rien, même active. Sans elle,
 * une session entretenue par un onglet ouvert vaudrait un mot de passe permanent.
 *
 * `lastSeenAt` porte le **glissement** : une session utilisée se prolonge, jusqu'au plafond absolu.
 * Elle n'est réécrite que lorsque l'écart dépasse `SLIDE_WRITE_THRESHOLD_MS` — sans ce seuil, chaque
 * affichage d'écran écrirait une ligne, et cette table deviendrait le point chaud du tableau de bord
 * pour une précision dont personne n'a besoin.
 *
 * ## Une session partielle vit peu, et ne glisse pas
 *
 * Elle ne sert qu'à porter le second facteur — celui que step-023 fera valider par un code à six
 * chiffres. Lui donner le plafond d'une session complète laisserait douze heures pour deviner ce
 * code, et la faire glisser suffirait à tenir cette fenêtre ouverte depuis un onglet oublié. Elle
 * expire donc en `PENDING_LIFETIME_MS`, et c'est le passage du second facteur — lui seul — qui
 * déplace la fin de validité au plafond absolu.
 */

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import { operatorSessions } from '../db/schema/session'

/**
 * Durée absolue d'une session **complète** : au-delà, il faut se reconnecter, quoi qu'il arrive.
 *
 * Exportée parce que le `Max-Age` du cookie s'en déduit : deux constantes séparées finiraient par
 * dire deux choses, et c'est le porteur qui survivrait à ce qu'il désigne.
 */
export const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000

/** Durée d'une session **partielle**, sans glissement possible : voir l'en-tête. */
const PENDING_LIFETIME_MS = 10 * 60 * 1000

/** Inactivité tolérée avant qu'une session ne cesse d'être glissée. */
const IDLE_LIFETIME_MS = 60 * 60 * 1000

/** En deçà, on ne réécrit pas `lastSeenAt` : voir l'en-tête. */
const SLIDE_WRITE_THRESHOLD_MS = 60 * 1000

/**
 * `interval '<n> milliseconds'`, la seule interpolation brute admise ici.
 *
 * Les durées sont des constantes de ce module — jamais une valeur venue d'une requête. Le jour où
 * l'une d'elles viendrait d'ailleurs, ce helper devrait disparaître avec elle.
 */
function intervalMs(milliseconds: number) {
  return sql.raw(`interval '${milliseconds} milliseconds'`)
}

export type SessionState =
  /** Session complète : second facteur passé, les écrans sont ouverts. */
  | { readonly status: 'active'; readonly sessionId: string; readonly operatorId: string }
  /**
   * Mot de passe validé, second facteur en attente. **N'ouvre aucun écran** — elle ne sert qu'à
   * porter la vérification de step-023 / step-024.
   */
  | { readonly status: 'pending_mfa'; readonly sessionId: string; readonly operatorId: string }
  /** Absente, expirée, révoquée, inactive trop longtemps, ou opérateur désactivé. Un seul cas. */
  | { readonly status: 'none' }

/**
 * Ouvre une session **partielle** — le second facteur reste à passer.
 *
 * C'est le seul point de création : une session ne naît jamais complète, même pour un opérateur sans
 * MFA enrôlé. Le contraire ouvrirait un chemin où un mot de passe seul suffit, ce que step-021 existe
 * précisément pour empêcher.
 */
export async function openPendingSession(
  db: Database,
  operatorId: string,
): Promise<{ sessionId: string }> {
  const [row] = await db
    .insert(operatorSessions)
    .values({
      operatorId,
      // Le plafond court, pas l'absolu : la session ne porte encore qu'un mot de passe.
      expiresAt: sql`now() + ${intervalMs(PENDING_LIFETIME_MS)}`,
    })
    .returning({ id: operatorSessions.id })

  if (!row) throw new Error("La session n'a pas pu être créée.")
  return { sessionId: row.id }
}

/**
 * Promeut une session partielle en session complète. Sans effet sur une session déjà complète.
 *
 * C'est **ici** que la fin de validité passe du plafond court au plafond absolu : la promotion est le
 * seul moment où l'on sait que les deux facteurs ont été présentés. La repousser ailleurs — à la
 * première lecture, par exemple — reviendrait à prolonger une session qui n'a rien prouvé de plus.
 */
export async function completeMfa(db: Database, sessionId: string): Promise<void> {
  await db
    .update(operatorSessions)
    .set({
      mfaCompletedAt: sql`now()`,
      lastSeenAt: sql`now()`,
      expiresAt: sql`now() + ${intervalMs(ABSOLUTE_LIFETIME_MS)}`,
    })
    .where(and(eq(operatorSessions.id, sessionId), isNull(operatorSessions.mfaCompletedAt)))
}

/**
 * Lit l'état d'une session, et la fait glisser si elle est vivante **et complète**.
 *
 * Le filtre sur `operators.status` est **ici**, comme pour la résolution des permissions : désactiver
 * un opérateur doit le mettre dehors immédiatement, sans avoir à révoquer ses sessions une par une.
 * Le laisser à l'appelant ferait dépendre la sécurité de l'endroit où le statut est vérifié —
 * c'est-à-dire, à terme, de nulle part.
 */
export async function readSession(db: Database, sessionId: string): Promise<SessionState> {
  const [row] = await db
    .select({
      id: operatorSessions.id,
      operatorId: operatorSessions.operatorId,
      mfaCompletedAt: operatorSessions.mfaCompletedAt,
      lastSeenAt: operatorSessions.lastSeenAt,
    })
    .from(operatorSessions)
    .innerJoin(operators, eq(operators.id, operatorSessions.operatorId))
    .where(
      and(
        eq(operatorSessions.id, sessionId),
        isNull(operatorSessions.revokedAt),
        sql`${operatorSessions.expiresAt} > now()`,
        sql`${operatorSessions.lastSeenAt} > now() - ${intervalMs(IDLE_LIFETIME_MS)}`,
        eq(operators.status, 'active'),
      ),
    )

  if (!row) return { status: 'none' }

  // Une session partielle ne glisse pas : la faire glisser rendrait son plafond court inopérant, un
  // onglet qui interroge `/auth/me` suffisant à le repousser indéfiniment.
  if (row.mfaCompletedAt && Date.now() - row.lastSeenAt.getTime() > SLIDE_WRITE_THRESHOLD_MS) {
    await db
      .update(operatorSessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(operatorSessions.id, sessionId))
  }

  return row.mfaCompletedAt
    ? { status: 'active', sessionId: row.id, operatorId: row.operatorId }
    : { status: 'pending_mfa', sessionId: row.id, operatorId: row.operatorId }
}

/**
 * Durée de vie d'un défi WebAuthn.
 *
 * Quelques minutes : c'est le temps qu'il faut à un opérateur pour approuver sur son téléphone ou
 * poser son doigt, pas davantage. Un défi qui traîne est un défi qu'on peut essayer de faire signer.
 */
const WEBAUTHN_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000

/**
 * Émet un défi pour une cérémonie WebAuthn, en **remplaçant** celui qui traînait.
 *
 * Remplacer et non ajouter : recommencer une cérémonie est ordinaire — l'opérateur ferme la fenêtre
 * du navigateur — et laisser deux défis valables laisserait deux cérémonies ouvertes.
 */
export async function issueWebAuthnChallenge(
  db: Database,
  sessionId: string,
  challenge: string,
): Promise<void> {
  await db
    .update(operatorSessions)
    .set({
      webauthnChallenge: challenge,
      webauthnChallengeExpiresAt: sql`now() + ${intervalMs(WEBAUTHN_CHALLENGE_LIFETIME_MS)}`,
    })
    .where(eq(operatorSessions.id, sessionId))
}

/**
 * Consomme le défi d'une session, ou rend `undefined`.
 *
 * ## Pourquoi un `SELECT … FOR UPDATE` et pas un simple `UPDATE … RETURNING`
 *
 * Parce que `RETURNING` rend la ligne **après** écriture : la colonne y vaut déjà `NULL`, et l'on
 * perdrait précisément la valeur qu'on vient de consommer. Le contourner par un auto-join
 * (`UPDATE … FROM operator_sessions prev`) marche en séquentiel et se casse en concurrence : la
 * relecture que PostgreSQL fait après avoir attendu la transaction concurrente ne réévalue pas les
 * conditions portées par l'autre côté du join, si bien que deux appelants pourraient lire le même
 * défi.
 *
 * Le verrou explicite ferme les deux problèmes d'un coup. En `READ COMMITTED`, `FOR UPDATE` fait
 * attendre le second appelant, puis **relit la ligne et réapplique le `WHERE`** : il voit alors un
 * défi remis à `NULL`, la clause commune ne rend aucune ligne, et l'usage unique tient — y compris
 * entre deux instances.
 *
 * L'échéance vit dans le `WHERE` plutôt qu'après lecture : un défi périmé n'est pas rendu puis
 * rejeté, il n'existe plus.
 */
export async function consumeWebAuthnChallenge(
  db: Database,
  sessionId: string,
): Promise<string | undefined> {
  const rows = await db.execute<{ challenge: string }>(sql`
    WITH locked AS (
      SELECT id, webauthn_challenge
      FROM operator_sessions
      WHERE id = ${sessionId}
        AND webauthn_challenge IS NOT NULL
        AND webauthn_challenge_expires_at > now()
      FOR UPDATE
    )
    UPDATE operator_sessions AS s
    SET webauthn_challenge = NULL, webauthn_challenge_expires_at = NULL
    FROM locked
    WHERE s.id = locked.id
    RETURNING locked.webauthn_challenge AS challenge
  `)

  return rows[0]?.challenge ?? undefined
}

/**
 * Révoque une session. Idempotent, et **immédiat pour toutes les instances** puisque l'état vit en
 * base : aucune n'a de cache à invalider.
 */
export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(operatorSessions.id, sessionId), isNull(operatorSessions.revokedAt)))
}

/**
 * Ferme la session portée par une requête, s'il y en a une.
 *
 * Une session partielle se ferme comme une autre : abandonner un second facteur en cours doit fermer
 * ce qui a été ouvert, sinon la session traînerait jusqu'à son expiration. Et une absence de session
 * n'est pas une erreur — c'est le cas d'une déconnexion sans cookie, qui doit aboutir en silence.
 */
export async function endSession(db: Database, session: SessionState): Promise<void> {
  if (session.status === 'none') return
  await revokeSession(db, session.sessionId)
}

/**
 * Révoque **toutes** les sessions d'un opérateur.
 *
 * Le geste qui compte le jour où l'on désactive quelqu'un, où l'on soupçonne un vol de cookie, ou où
 * l'on retire un rôle sensible. Rend le nombre de sessions fermées, pour que l'appelant puisse
 * l'écrire au journal d'audit.
 */
export async function revokeAllSessionsOf(db: Database, operatorId: string): Promise<number> {
  const closed = await db
    .update(operatorSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(operatorSessions.operatorId, operatorId), isNull(operatorSessions.revokedAt)))
    .returning({ id: operatorSessions.id })

  return closed.length
}

/**
 * Purge les sessions mortes depuis longtemps.
 *
 * On garde les lignes révoquées un temps — le journal d'audit peut y faire référence — mais pas
 * indéfiniment : chaque connexion en crée une, et personne ne les relit après un mois.
 */
export async function purgeDeadSessions(db: Database): Promise<number> {
  const removed = await db
    .delete(operatorSessions)
    .where(
      or(
        lt(operatorSessions.expiresAt, sql`now() - interval '30 days'`),
        and(
          sql`${operatorSessions.revokedAt} IS NOT NULL`,
          lt(operatorSessions.revokedAt, sql`now() - interval '30 days'`),
        ),
      ),
    )
    .returning({ id: operatorSessions.id })

  return removed.length
}
