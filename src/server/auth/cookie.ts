/**
 * Le cookie de session : signature, vérification, rotation de clé.
 *
 * Le cookie ne transporte **qu'un identifiant de session**, signé. Pas de permissions, pas
 * d'identité, pas de date d'expiration exploitable — tout cela vit en base, où il peut être révoqué
 * et où un changement de rôle prend effet sans reconnexion.
 *
 * ## À quoi sert la signature, puisque l'identifiant est en base
 *
 * À ne pas aller en base pour rien. Sans elle, chaque cookie forgé coûterait une requête, et
 * l'énumération d'identifiants deviendrait gratuite pour l'attaquant et payante pour nous. La
 * signature filtre en mémoire ce qui n'a jamais été émis ici.
 *
 * Elle ne remplace pas la vérification en base : un identifiant correctement signé peut désigner une
 * session révoquée, échue, ou appartenant à un opérateur désactivé. **La signature dit « nous avons
 * émis ceci » ; seule la base dit « ceci est encore valable ».**
 *
 * ## Rotation
 *
 * `AUTH_SESSION_SECRET` porte la clé courante, `AUTH_SESSION_SECRET_PREVIOUS` l'ancienne. On **signe**
 * toujours avec la courante et on **accepte** les deux : changer de clé ne déconnecte donc personne,
 * et l'ancienne cesse d'être acceptée quand on retire la variable, à la fenêtre choisie par
 * l'exploitant. Sans ce mécanisme, toute rotation serait une déconnexion générale — c'est-à-dire une
 * rotation qu'on ne fait jamais.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Nom du cookie. Le préfixe `__Host-` refuse tout cookie posé sans `Secure` ou avec un `Domain`. */
export const SESSION_COOKIE_NAME = '__Host-gwbo_session'

export type SessionSecrets = {
  /** Clé de signature courante. */
  readonly current: string
  /** Clé précédente, acceptée en vérification le temps d'une rotation. */
  readonly previous?: string
}

/**
 * Lit les clés dans l'environnement.
 *
 * Aucune valeur par défaut : une clé de repli codée en dur serait publique, et n'importe qui
 * pourrait alors signer une session — c'est-à-dire se connecter en tant que n'importe qui.
 */
export function readSessionSecrets(env: NodeJS.ProcessEnv): SessionSecrets {
  const current = env.AUTH_SESSION_SECRET
  if (!current || current.length < 32) {
    throw new Error(
      'AUTH_SESSION_SECRET est requise et doit faire au moins 32 caractères : elle signe les sessions.',
    )
  }

  const previous = env.AUTH_SESSION_SECRET_PREVIOUS
  // Une clé précédente trop courte est ignorée plutôt que refusée : elle ne sert qu'à accepter des
  // cookies déjà émis, et faire échouer le démarrage pour une variable en cours de retrait serait
  // pire que le problème.
  return previous && previous.length >= 32 ? { current, previous } : { current }
}

/** `<identifiant>.<signature>` — la forme que le cookie transporte. */
export function signSessionId(sessionId: string, secrets: SessionSecrets): string {
  return `${sessionId}.${sign(sessionId, secrets.current)}`
}

/**
 * Rend l'identifiant si la signature est valide sous l'une des clés acceptées, `undefined` sinon.
 *
 * Jamais d'exception : un cookie malformé est le cas ordinaire — cookie d'une ancienne version,
 * troncature d'un proxy, bricolage d'un curieux — et doit se traiter comme une absence de session,
 * pas comme une erreur serveur.
 */
export function verifySessionCookie(value: string, secrets: SessionSecrets): string | undefined {
  // Un seul point de séparation : un identifiant ne contient pas de point, une signature non plus.
  // `lastIndexOf` traiterait un cookie bricolé comme valide s'il contenait un point de plus.
  const separator = value.indexOf('.')
  if (separator <= 0 || separator === value.length - 1) return undefined

  const sessionId = value.slice(0, separator)
  const signature = value.slice(separator + 1)

  for (const secret of [secrets.current, secrets.previous]) {
    if (secret && matches(signature, sign(sessionId, secret))) return sessionId
  }

  return undefined
}

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId, 'utf8').digest('base64url')
}

/**
 * Comparaison à temps constant.
 *
 * `timingSafeEqual` lève si les longueurs diffèrent : on les compare d'abord, ce qui ne divulgue que
 * la longueur d'une signature — une constante connue de tous.
 */
function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Les attributs du cookie, tels qu'ils partent dans `Set-Cookie`.
 *
 * - `HttpOnly` — hors de portée de tout script, donc d'une injection.
 * - `Secure` — jamais en clair sur le réseau ; exigé par le préfixe `__Host-`.
 * - `SameSite=Lax` — une requête cross-site n'emporte pas la session. `Strict` casserait le retour
 *   depuis un lien externe, ce qui pousserait à baisser la garde ailleurs.
 * - `Path=/` — imposé par `__Host-`, qui interdit `Domain` et exige la racine. C'est ce qui empêche
 *   un sous-domaine compromis de poser un cookie que nous accepterions.
 */
export function sessionCookieAttributes(maxAgeSeconds: number): string {
  return `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

/** L'en-tête qui efface le cookie. `Max-Age=0` plutôt qu'une date passée : pas de fuseau à discuter. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}
