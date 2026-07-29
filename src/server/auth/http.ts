/**
 * La traduction d'une décision d'authentification en réponse HTTP.
 *
 * Séparée du transport pour être testable : c'est ici que se joue la discrétion de la réponse, et
 * une règle qui n'est pas testée finit par être adoucie sans que personne ne le voie.
 *
 * **Un seul corps d'erreur, un seul code.** Identifiant inconnu, mot de passe faux, compte
 * désactivé, compte verrouillé : tout rend le même 401 et le même texte. Distinguer, c'est
 * divulguer — et la distinction se glisse toujours par commodité de débogage.
 */

import {
  SESSION_COOKIE_NAME,
  type SessionSecrets,
  sessionCookieAttributes,
  signSessionId,
} from './cookie'
import type { LoginOutcome } from './login'

/**
 * Durée de vie du cookie, en secondes.
 *
 * Volontairement plus courte que la session en base : le cookie n'est qu'un porteur, et le laisser
 * survivre à ce qu'il désigne n'apporte rien qu'une reconnexion silencieuse de plus. La base reste
 * l'autorité — un cookie encore présent sur une session révoquée ne vaut rien.
 */
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60

/** Le seul message d'échec de connexion. Il ne dit pas ce qui a échoué, parce qu'il ne le doit pas. */
export const INVALID_CREDENTIALS_MESSAGE =
  'Connexion refusée : identifiant ou mot de passe incorrect.'

const RATE_LIMITED_MESSAGE =
  'Connexion refusée : trop de tentatives depuis cette adresse. Réessayez plus tard.'

export function loginResponse(outcome: LoginOutcome, secrets?: SessionSecrets): Response {
  if (outcome.outcome === 'mfa_required') {
    // **Pas d'identifiant d'opérateur, ni d'identifiant de session dans le corps** : les rendre au
    // navigateur sortirait du `HttpOnly`, donc les mettrait à portée d'un script injecté. Le lien
    // avec la vérification du second facteur passe entièrement par le cookie.
    const cookie = secrets
      ? `${SESSION_COOKIE_NAME}=${signSessionId(outcome.sessionId, secrets)}; ${sessionCookieAttributes(COOKIE_MAX_AGE_SECONDS)}`
      : undefined

    return json({ mfa_required: true }, 200, cookie ? { 'set-cookie': cookie } : {})
  }

  if (outcome.outcome === 'rate_limited') {
    return json({ error: RATE_LIMITED_MESSAGE }, 429, {
      'retry-after': String(outcome.retryAfterSeconds),
    })
  }

  return json({ error: INVALID_CREDENTIALS_MESSAGE }, 401)
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Une réponse d'authentification ne se met jamais en cache : ni dans le navigateur, ni dans un
      // intermédiaire qui la servirait à quelqu'un d'autre.
      'cache-control': 'no-store',
      ...headers,
    },
  })
}

export type ParsedCredentials =
  | { readonly ok: true; readonly identifier: string; readonly password: string }
  | { readonly ok: false }

/**
 * Lit les identifiants d'un corps de requête déjà décodé.
 *
 * Un corps malformé rend `ok: false` et sera traité **exactement** comme un échec d'authentification.
 * Répondre 400 sur une saisie invalide et 401 sur une saisie valide donnerait un moyen de sonder le
 * point d'entrée sans coût, et un chemin plus rapide que la vérification — donc un oracle de plus.
 */
export function parseCredentials(body: unknown): ParsedCredentials {
  if (typeof body !== 'object' || body === null) return { ok: false }

  const { identifier, password } = body as Record<string, unknown>
  if (typeof identifier !== 'string' || typeof password !== 'string') return { ok: false }
  if (identifier.length === 0 || password.length === 0) return { ok: false }

  // Une borne haute, parce que le mot de passe part dans scrypt : un mégaoctet de saisie coûterait
  // une place de vérification pour rien.
  if (identifier.length > 320 || password.length > 1024) return { ok: false }

  return { ok: true, identifier, password }
}
