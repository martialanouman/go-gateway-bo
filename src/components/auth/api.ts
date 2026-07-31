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

/**
 * Raccroche l'échéance au message. Sans en-tête, on n'en fabrique pas : « 0 seconde » serait faux.
 *
 * La phrase vague du serveur est **remplacée**, pas complétée. Ses messages de suspension finissent
 * par « Réessayez plus tard. » ; y ajouter la nôtre donnait « Réessayez plus tard. Réessayez dans
 * 2 minutes. » — deux consignes dans une phrase, dont la première est celle que l'échéance existe
 * pour corriger.
 */
function withDelay(message: string, response: Response): string {
  const header = response.headers.get('retry-after')
  const seconds = header === null ? Number.NaN : Number(header)

  if (!Number.isFinite(seconds) || seconds <= 0) return message

  return `${message.replace(/\s*Réessayez plus tard\.\s*$/u, '')} Réessayez dans ${formatRetryDelay(seconds)}.`
}

/**
 * Traduit une réponse d'échec en issue.
 *
 * Le `fallback` sert au cas où le corps n'est pas exploitable : un serveur derrière un proxy peut
 * rendre une page HTML sur un 502, et l'écran doit quand même dire quelque chose de vrai.
 */
async function refusalFrom(response: Response, fallback: string): Promise<LoginResult & MfaResult> {
  // **Un 5xx n'est pas un refus, et le dire compte.** Peindre « Connexion refusée » pendant une
  // panne du BFF fait conclure à chaque opérateur que son mot de passe ne marche plus : il essaie
  // des variantes, puis appelle le support pour une réinitialisation dont il n'a pas besoin. Rien
  // n'a été refusé — le serveur est cassé.
  if (response.status >= 500) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

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
 * Refus de cérémonie qui **n'est pas** un abandon.
 *
 * `SecurityError` — origine ou `rpID` qui ne correspondent pas —, `NotSupportedError`, contexte non
 * sécurisé : autant d'erreurs de déploiement. Les peindre en « l'appareil n'a pas confirmé » les
 * rendrait indiagnosticables : tous les opérateurs verraient la même invitation à réessayer, en ton
 * information, indéfiniment, et personne n'aurait de quoi remonter la vraie cause. Le nom technique
 * est conservé pour cela, et lui seul — il ne porte aucune donnée.
 */
function passkeyCeremonyFailure(error: unknown): PasskeyResult {
  // `NotAllowedError` couvre la fermeture de la fenêtre système, le délai écoulé et la biométrie
  // refusée. Rien de tout cela n'est une panne, et rien ne doit être peint comme telle.
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return { outcome: 'cancelled', message: PASSKEY_CANCELLED_MESSAGE }
  }

  const name = error instanceof Error ? error.name : 'erreur inconnue'
  return {
    outcome: 'refused',
    message: `Vérification impossible sur cet appareil (${name}). Utilisez votre code TOTP, et signalez ce code à l’exploitation.`,
  }
}

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
    // 409 sur la **première** phase signifie « rien à vérifier par ce facteur » : le compte est
    // connu et la session valide, il n'y a simplement aucun appareil. C'est le seul cas propre à
    // cette phase.
    if (started.status === 409) {
      return {
        outcome: 'no_passkey',
        message: (await readErrorMessage(started)) ?? 'Aucun appareil enregistré sur ce compte.',
      }
    }

    // Tout le reste suit la règle commune, y compris « un 5xx n'est pas un refus ». Cette phase
    // l'appliquait à la main et avait oublié cette moitié-là : un 502 rendait « Vérification
    // refusée », et l'opérateur en concluait que sa passkey était rejetée pendant une panne du BFF.
    return refusalFrom(started, 'Vérification refusée.')
  }

  // **Le seul `await` qui pouvait encore lever**, alors que l'en-tête de ce fichier promet le
  // contraire. Un intermédiaire qui rend un 200 avec du HTML faisait rejeter `json()` : l'écran
  // restait figé sur « Vérification en cours », les deux onglets bloqués par le même `busy`, sans
  // un mot — le seul recours étant de recharger la page.
  const payload = (await started.json().catch(() => undefined)) as
    | { options?: PublicKeyCredentialRequestOptionsJSON }
    | undefined

  if (!payload?.options) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  const assertion = await startAuthentication({ optionsJSON: payload.options }).catch(
    (error: unknown) => passkeyCeremonyFailure(error),
  )

  // Une issue plutôt qu'une signature : la cérémonie a échoué, et son diagnostic est déjà composé.
  if ('outcome' in assertion) return assertion

  const verified = await postJson('/api/auth/mfa/passkey/verify', { response: assertion }).catch(
    () => undefined,
  )
  if (!verified) return { outcome: 'unreachable', message: UNREACHABLE_MESSAGE }

  if (verified.ok) return { outcome: 'completed' }

  return refusalFrom(verified, 'Vérification refusée.')
}
