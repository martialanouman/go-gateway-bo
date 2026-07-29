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
 */

import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { operators } from '../db/schema/auth'
import { operatorSessions } from '../db/schema/session'

/** Durée absolue : au-delà, il faut se reconnecter, quoi qu'il arrive. */
const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000

/** Inactivité tolérée avant qu'une session ne cesse d'être glissée. */
const IDLE_LIFETIME_MS = 60 * 60 * 1000

/** En deçà, on ne réécrit pas `lastSeenAt` : voir l'en-tête. */
const SLIDE_WRITE_THRESHOLD_MS = 60 * 1000

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
      expiresAt: new Date(Date.now() + ABSOLUTE_LIFETIME_MS),
    })
    .returning({ id: operatorSessions.id })

  if (!row) throw new Error("La session n'a pas pu être créée.")
  return { sessionId: row.id }
}

/** Promeut une session partielle en session complète. Sans effet sur une session déjà complète. */
export async function completeMfa(db: Database, sessionId: string): Promise<void> {
  await db
    .update(operatorSessions)
    .set({ mfaCompletedAt: sql`now()`, lastSeenAt: sql`now()` })
    .where(and(eq(operatorSessions.id, sessionId), isNull(operatorSessions.mfaCompletedAt)))
}

/**
 * Lit l'état d'une session, et la fait glisser si elle est vivante.
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
        sql`${operatorSessions.lastSeenAt} > now() - ${sql.raw(`interval '${IDLE_LIFETIME_MS} milliseconds'`)}`,
        eq(operators.status, 'active'),
      ),
    )

  if (!row) return { status: 'none' }

  if (Date.now() - row.lastSeenAt.getTime() > SLIDE_WRITE_THRESHOLD_MS) {
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
