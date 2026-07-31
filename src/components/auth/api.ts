/**
 * Les appels d'authentification, côté navigateur.
 *
 * ## Les messages viennent du serveur, verbatim
 *
 * Aucun refus n'est rédigé ici. Le serveur a choisi ses messages pour ne renseigner personne —
 * « identifiant ou mot de passe incorrect » ne dit pas si le compte existe, « code incorrect ou
 * expiré » ne dit pas si le code intercepté était le bon — et une seconde rédaction côté client
 * finirait par en dire plus, sans que personne ne s'en aperçoive avant une revue de sécurité.
 *
 * La seule chose composée ici est **la durée d'attente**, qui voyage dans l'en-tête `retry-after` et
 * ne peut donc pas être dans le corps.
 *
 * ## Pourquoi aucun `throw`
 *
 * Un refus d'authentification n'est pas une panne : c'est une réponse. Le faire remonter en exception
 * obligerait chaque écran à distinguer « le mot de passe est faux » de « le serveur est tombé » dans
 * un `catch`, et la première fois que quelqu'un l'oublierait, le formulaire resterait figé sur
 * « Connexion en cours ». Toutes les issues, réseau compris, rentrent dans le type de retour.
 */

import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { startAuthentication } from '@simplewebauthn/browser'

/** L'issue commune à tous les appels : chaque écran n'a que quatre cas à peindre. */
export type AuthOutcome<TSuccess> =
  | TSuccess
  /** Refus ordinaire — mauvais identifiants, mauvais code. Le message est celui du serveur. */
  | { readonly outcome: 'refused'; readonly message: string }
  /** Trop de tentatives. Le message porte l'échéance quand le serveur l'a donnée. */
  | { readonly outcome: 'suspended'; readonly message: string }
  /** Le serveur n'a pas répondu. Ce n'est pas la faute de l'opérateur, et il doit le savoir. */
  | { readonly outcome: 'unreachable'; readonly message: string }

export type LoginResult = AuthOutcome<{ readonly outcome: 'mfa_required' }>
export type MfaResult = AuthOutcome<{ readonly outcome: 'completed' }>

export const UNREACHABLE_MESSAGE =
  'Le serveur n’a pas répondu. Vérifiez votre connexion, puis réessayez.'

const SECONDS_PER_MINUTE = 60

/**
 * Met une durée en français, arrondie **au supérieur**.
 *
 * Arrondir à l'inférieur ferait réessayer trop tôt, et le second refus passerait pour un défaut du
 * produit plutôt que pour la fin d'un compte à rebours. On promet un peu trop d'attente, jamais trop
 * peu.
 */
export function formatRetryDelay(seconds: number): string {
  if (seconds < SECONDS_PER_MINUTE) {
    const value = Math.max(1, Math.ceil(seconds))
    return `${value} seconde${value > 1 ? 's' : ''}`
  }

  const minutes = Math.ceil(seconds / SECONDS_PER_MINUTE)
  return `${minutes} minute${minutes > 1 ? 's' : ''}`
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    // **Uniquement du JSON.** Le handler refuse le reste, et pas par goût : un formulaire
    // `urlencoded` est une *simple request*, donc sans preflight CORS — n'importe quelle page
    // visitée par un opérateur pourrait déclencher des tentatives depuis son navigateur.
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Lit le message d'erreur du corps, ou rend `undefined` si le corps n'en porte pas. */
async function readErrorMessage(response: Response): Promise<string | undefined> {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
  return typeof body?.error === 'string' ? body.error : undefined
}

/** Raccroche l'échéance au message. Sans en-tête, on n'en fabrique pas : « 0 seconde » serait faux. */
function withDelay(message: string, response: Response): string {
  const header = response.headers.get('retry-after')
  const seconds = header === null ? Number.NaN : Number(header)

  if (!Number.isFinite(seconds) || seconds <= 0) return message

  return `${message} Réessayez dans ${formatRetryDelay(seconds)}.`
}

/**
 * Traduit une réponse d'échec en issue.
 *
 * Le `fallback` sert au cas où le corps n'est pas exploitable : un serveur derrière un proxy peut
 * rendre une page HTML sur un 502, et l'écran doit quand même dire quelque chose de vrai.
 */
async function refusalFrom(response: Response, fallback: string): Promise<LoginResult & MfaResult> {
  const message = (await readErrorMessage(response)) ?? fallback

  return response.status === 429
    ? { outcome: 'suspended', message: withDelay(message, response) }
    : { outcome: 'refused', message }
}

export type Credentials = { readonly identifier: string; readonly password: string }

export async function login(credentials: Credentials): Promise<LoginResult> {
  const response = await postJson('/api/auth/login', credentials).catch(() => undefined)
  if (!response) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  if (response.ok) return { outcome: 'mfa_required' }

  return refusalFrom(response, 'Connexion refusée.')
}

export async function verifyTotp(code: string): Promise<MfaResult> {
  const response = await postJson('/api/auth/mfa/verify', { code }).catch(() => undefined)
  if (!response) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  if (response.ok) return { outcome: 'completed' }

  return refusalFrom(response, 'Vérification refusée.')
}

/**
 * Refus qui n'en est pas un : le compte n'a simplement aucun appareil enregistré.
 *
 * Il mérite son propre cas parce qu'il change ce que l'écran doit dire. Un refus invite à réessayer ;
 * celui-ci invite à prendre l'autre facteur. Les confondre laisse un opérateur cliquer indéfiniment
 * sur un bouton qui ne peut pas aboutir.
 */
export type PasskeyResult =
  | MfaResult
  | { readonly outcome: 'no_passkey'; readonly message: string }
  | { readonly outcome: 'cancelled'; readonly message: string }

export const PASSKEY_CANCELLED_MESSAGE =
  'Vérification interrompue : l’appareil n’a pas confirmé. Réessayez, ou utilisez votre code TOTP.'

/**
 * La cérémonie d'authentification par passkey, en deux allers-retours.
 *
 * Le premier demande les options — elles portent le défi, qui ne vaut que pour cette session — le
 * navigateur signe, le second présente la signature. Rien n'est décidé ici : c'est le serveur qui
 * vérifie l'origine, le défi et le compteur.
 */
export async function verifyPasskey(): Promise<PasskeyResult> {
  const started = await postJson('/api/auth/mfa/passkey/verify', {}).catch(() => undefined)
  if (!started) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  if (!started.ok) {
    const message = (await readErrorMessage(started)) ?? 'Vérification refusée.'

    // 409 sur la **première** phase signifie « rien à vérifier par ce facteur » : le compte est
    // connu et la session valide, il n'y a simplement aucun appareil.
    if (started.status === 409) return { outcome: 'no_passkey', message }

    return started.status === 429
      ? { outcome: 'suspended', message: withDelay(message, started) }
      : { outcome: 'refused', message }
  }

  const { options } = (await started.json()) as { options: PublicKeyCredentialRequestOptionsJSON }

  const assertion = await startAuthentication({ optionsJSON: options }).catch(() => undefined)
  // Fermer la fenêtre système, laisser expirer le délai, refuser la biométrie : le navigateur les
  // renvoie tous en `NotAllowedError`, et aucun n'est une panne. Les peindre en alerte apprendrait à
  // l'opérateur à ignorer les alertes.
  if (!assertion) return { outcome: 'cancelled', message: PASSKEY_CANCELLED_MESSAGE }

  const verified = await postJson('/api/auth/mfa/passkey/verify', { response: assertion }).catch(
    () => undefined,
  )
  if (!verified) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  if (verified.ok) return { outcome: 'completed' }

  return refusalFrom(verified, 'Vérification refusée.')
}
