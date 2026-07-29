/**
 * Le compteur d'échecs d'authentification.
 *
 * Deux portées indépendantes, et elles ne se comportent pas de la même façon parce qu'elles ne
 * protègent pas la même chose :
 *
 * - **par identifiant** — empêche de casser *un* compte. Le verrouillage y est **silencieux** : la
 *   réponse reste celle d'un échec ordinaire. Annoncer « compte verrouillé » confirmerait l'existence
 *   du compte, et comme un attaquant peut provoquer ce verrouillage à volonté, il énumérerait les
 *   comptes en les bloquant.
 * - **par adresse IP** — empêche de balayer *tous* les comptes. Le refus y est **explicite** : il ne
 *   parle que de l'appelant et ne révèle donc rien. C'est aussi la seule barrière qu'on peut opposer
 *   avant tout travail coûteux.
 *
 * L'opérateur légitime dont le compte est verrouillé par un tiers ne l'apprend donc pas dans la
 * réponse. Il faut le lui dire **hors bande** — une notification au titulaire au moment du
 * verrouillage, qui ne fuite rien puisque l'attaquant ne lit pas sa boîte. C'est le travail de la
 * step-046 (centre de notifications) ; d'ici là, le canal est le support interne.
 *
 * ## L'incrément est atomique, en une seule requête
 *
 * `SELECT` puis `UPDATE` laisserait une rafale parallèle passer sous le seuil : sur deux instances,
 * dix requêtes simultanées liraient toutes « quatre échecs » et écriraient toutes « cinq ». Le
 * compteur ne compterait plus rien précisément au moment où il compte. `INSERT … ON CONFLICT DO
 * UPDATE` fait l'opération sous le verrou de ligne de PostgreSQL.
 */

import { createHmac } from 'node:crypto'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import type { Database } from '../db/index'
import { loginAttempts } from '../db/schema/throttle'

export type ThrottleScope = 'operator' | 'ip' | 'mfa'

/** Fenêtre d'oubli : au-delà, les échecs anciens ne comptent plus. */
const WINDOW_MS = 15 * 60 * 1000

/**
 * Seuils, par portée. L'IP est plus large : plusieurs opérateurs peuvent partager une sortie NAT.
 *
 * `mfa` est aussi serré que `operator`, et pour une raison plus forte : un code à six chiffres, c'est
 * un million de possibilités, mais la fenêtre de dérive en accepte trois à la fois — une tentative
 * sur trois cent mille aboutit. Sans plafond, quelques heures de requêtes suffisent. Le plafond court
 * de la session partielle borne déjà la fenêtre à dix minutes ; il la rend étroite, il ne la ferme
 * pas, et il disparaît dès qu'une session complète re-demande un facteur.
 */
export const THRESHOLDS: Readonly<Record<ThrottleScope, number>> = { operator: 5, ip: 20, mfa: 5 }

/** Verrouillage initial, puis doublement à chaque verrouillage successif, borné **par portée**. */
const BASE_LOCK_MS = 15 * 60 * 1000

/**
 * Plafond du verrouillage, et il n'est pas le même partout.
 *
 * Le doublement existe pour rendre une force brute *patiente* de plus en plus chère. Il n'a de sens
 * que là où la patience paie.
 *
 * **Pour `mfa`, elle ne paie pas** : cinq essais par quart d'heure contre un code à six chiffres
 * repoussent la découverte à des siècles, escalade ou non. Elle coûterait en revanche cher en
 * disponibilité, et d'une façon qui n'existe pas ailleurs — ce verrou ne se déclenche qu'avec une
 * session déjà ouverte par un mot de passe valide. Autrement dit, quiconque détient le mot de passe
 * d'un opérateur **sans** son second facteur peut le déclencher à volonté : avec l'escalade, cinq
 * requêtes par palier suffiraient à mettre le titulaire dehors quatre heures d'affilée, puis à
 * recommencer. Le plafond au premier palier borne le dégât à un quart d'heure sans rien céder.
 *
 * Ce qui reste, et qu'aucun plafond ne réglera : un attaquant qui répète la manœuvre garde
 * l'opérateur dehors. Cela se traite **hors bande** — une notification au titulaire au moment du
 * verrouillage (step-046) — pas en desserrant le compteur.
 */
const MAX_LOCK_MS: Readonly<Record<ThrottleScope, number>> = {
  operator: 4 * 60 * 60 * 1000,
  ip: 4 * 60 * 60 * 1000,
  mfa: BASE_LOCK_MS,
}

export type LockState = {
  readonly locked: boolean
  /**
   * Fin du verrouillage. **Absente pour la portée `operator`**, et pour elle seule : ce verrou est
   * silencieux, puisque l'annoncer confirmerait l'existence du compte à qui ne l'a pas encore.
   *
   * Les portées `ip` et `mfa` la donnent. La première ne parle que de l'appelant. La seconde ne
   * s'atteint qu'avec une session déjà ouverte par un mot de passe valide : celui qui la reçoit sait
   * déjà que le compte existe, et lui cacher l'échéance ne ferait que le laisser réessayer en vain.
   */
  readonly until?: Date
}

/**
 * La clé sous laquelle un sujet est compté.
 *
 * **Seule la portée `operator` passe par un HMAC**, parce qu'elle seule accumule des valeurs
 * *tentées* : les suppositions d'un attaquant, et les mots de passe que des opérateurs tapent dans le
 * champ email par inadvertance. Une adresse IP et un identifiant d'opérateur sont, eux, des faits
 * que nous connaissons déjà — les masquer empêcherait l'exploitation de lire qui est bloqué sans rien
 * protéger de plus.
 *
 * Et un HMAC plutôt qu'un condensat nu : un SHA-256 d'adresse email se casse par dictionnaire en
 * quelques secondes, ce qui rendrait le hachage décoratif.
 */
export function subjectKey(scope: ThrottleScope, value: string, secret: string): string {
  if (scope !== 'operator') return value
  return createHmac('sha256', secret).update(value.trim().toLowerCase(), 'utf8').digest('hex')
}

/**
 * Lit la clé HMAC dans l'environnement.
 *
 * Aucune valeur par défaut : une clé de repli codée en dur serait publique, et le HMAC redeviendrait
 * un condensat nu — c'est-à-dire la liste des identifiants tentés, cassable par dictionnaire.
 */
export function readThrottleSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.AUTH_THROTTLE_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_THROTTLE_SECRET est requise et doit faire au moins 32 caractères : elle protège les identifiants tentés.',
    )
  }
  return secret
}

/** L'état du verrou pour un sujet. Une échéance passée vaut ouvert — aucun nettoyage nécessaire. */
export async function lockState(
  db: Database,
  scope: ThrottleScope,
  subject: string,
): Promise<LockState> {
  const [row] = await db
    .select({ lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.scope, scope), eq(loginAttempts.subject, subject)))

  const until = row?.lockedUntil
  if (!until || until.getTime() <= Date.now()) return { locked: false }

  return scope === 'operator' ? { locked: true } : { locked: true, until }
}

/**
 * Enregistre un échec et rend l'état du verrou qui en résulte.
 *
 * Doit être appelé **sur les deux chemins** — identifiant connu comme inconnu. Ne compter que les
 * identifiants existants rendrait l'écriture asymétrique, et l'écart de latence entre « une écriture
 * Postgres » et « aucune » suffit à énumérer les comptes.
 */
export async function registerFailure(
  db: Database,
  scope: ThrottleScope,
  subject: string,
): Promise<LockState> {
  const threshold = THRESHOLDS[scope]

  const [row] = await db
    .insert(loginAttempts)
    .values({ scope, subject, failures: 1 })
    .onConflictDoUpdate({
      target: [loginAttempts.scope, loginAttempts.subject],
      set: {
        // La fenêtre glissante vit **dans le SQL** : hors fenêtre, le compteur repart à un plutôt
        // que de s'incrémenter. Le calculer côté application aurait exigé de relire d'abord, ce qui
        // rouvre la course que cette requête unique ferme.
        failures: sql`CASE WHEN ${loginAttempts.windowStartedAt} < now() - ${sql.raw(`interval '${WINDOW_MS} milliseconds'`)}
                           THEN 1 ELSE ${loginAttempts.failures} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${loginAttempts.windowStartedAt} < now() - ${sql.raw(`interval '${WINDOW_MS} milliseconds'`)}
                                  THEN now() ELSE ${loginAttempts.windowStartedAt} END`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ failures: loginAttempts.failures, lockedUntil: loginAttempts.lockedUntil })

  const failures = row?.failures ?? 1
  if (failures < threshold) return { locked: false }

  // Ralentissement progressif : chaque palier franchi au-delà du seuil double la durée, jusqu'à un
  // plafond. Un attaquant patient paie de plus en plus cher ; un opérateur qui se trompe cinq fois
  // attend un quart d'heure.
  const steps = Math.min(failures - threshold, 10)
  const duration = Math.min(BASE_LOCK_MS * 2 ** steps, MAX_LOCK_MS[scope])
  const until = new Date(Date.now() + duration)

  await db
    .update(loginAttempts)
    .set({ lockedUntil: until, updatedAt: sql`now()` })
    .where(and(eq(loginAttempts.scope, scope), eq(loginAttempts.subject, subject)))

  return scope === 'operator' ? { locked: true } : { locked: true, until }
}

/** Efface le compteur après une authentification réussie. */
export async function clearFailures(
  db: Database,
  scope: ThrottleScope,
  subject: string,
): Promise<void> {
  await db
    .delete(loginAttempts)
    .where(and(eq(loginAttempts.scope, scope), eq(loginAttempts.subject, subject)))
}

/**
 * Purge les lignes dormantes.
 *
 * La table est alimentée par des sujets **tentés**, donc par un attaquant : sans purge, elle croît
 * sans borne sous son contrôle. Appelée par la maintenance, au même titre que les partitions
 * d'audit.
 */
export async function purgeStaleAttempts(db: Database): Promise<number> {
  const removed = await db
    .delete(loginAttempts)
    .where(
      and(
        lt(loginAttempts.updatedAt, sql`now() - interval '30 days'`),
        or(sql`${loginAttempts.lockedUntil} IS NULL`, lt(loginAttempts.lockedUntil, sql`now()`)),
      ),
    )
    .returning({ subject: loginAttempts.subject })

  return removed.length
}
