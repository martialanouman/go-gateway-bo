/**
 * L'enrôlement d'un second facteur, côté navigateur.
 *
 * ## Séparé d'`api.ts`, et pas par goût de la symétrie
 *
 * `api.ts` sert la **porte d'entrée** : trois appels que tout opérateur traverse à chaque session.
 * Ici, on manipule des **secrets au sens de l'invariant (b)** — un secret TOTP, des codes de
 * récupération — qui ne sortent qu'une fois et ne sont jamais réaffichés. Les mêler au module de
 * connexion aurait dilué cette règle dans un fichier où elle ne s'applique pas.
 *
 * ## Les mêmes deux règles qu'`api.ts`
 *
 * Aucun refus n'est rédigé ici : les messages du serveur ne renseignent personne, et une seconde
 * rédaction finirait par en dire plus. Et **rien ne lève** — une exception laisserait l'écran figé
 * sur « Enregistrement en cours », avec un secret affiché qu'on ne pourra plus jamais revoir.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne conserve rien. Le secret et les codes de récupération traversent ces fonctions et
 * appartiennent ensuite à l'écran, dans un état local : jamais le cache Query, qui peut être persisté
 * ou inspecté, jamais une URL, jamais un toast.
 */

import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'
import { startRegistration } from '@simplewebauthn/browser'
import { UNREACHABLE_MESSAGE } from './api'

/** Un appareil enregistré, tel que le serveur le rend — sans clé publique ni compteur. */
export type Passkey = {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  readonly lastUsedAt?: string
  readonly deviceType?: string
  readonly backedUp?: boolean
}

export type TotpStart =
  | { readonly outcome: 'started'; readonly secret: string; readonly uri: string }
  /** Le compte a déjà un facteur : proposer d'en **ajouter** un, pas de recommencer. */
  | { readonly outcome: 'already_enrolled'; readonly message: string }
  | { readonly outcome: 'refused'; readonly message: string }
  | { readonly outcome: 'unreachable'; readonly message: string }

export type TotpConfirmation =
  /** Les codes ne repasseront **jamais** par ici : c'est le seul instant où ils existent côté client. */
  | { readonly outcome: 'activated'; readonly recoveryCodes: readonly string[] }
  /** L'enrôlement en cours a expiré ou été écrasé : le secret affiché ne vaut plus rien. */
  | { readonly outcome: 'expired'; readonly message: string }
  | { readonly outcome: 'refused'; readonly message: string }
  | { readonly outcome: 'unreachable'; readonly message: string }

export type PasskeyRegistration =
  | { readonly outcome: 'registered'; readonly passkeys: readonly Passkey[] }
  /** Fenêtre système fermée, délai écoulé, biométrie refusée. Pas une panne. */
  | { readonly outcome: 'cancelled'; readonly message: string }
  | { readonly outcome: 'refused'; readonly message: string }
  | { readonly outcome: 'unreachable'; readonly message: string }

export type PasskeyUpdate =
  | { readonly outcome: 'updated'; readonly passkeys: readonly Passkey[] }
  | { readonly outcome: 'refused'; readonly message: string }
  | { readonly outcome: 'unreachable'; readonly message: string }

export const PASSKEY_CANCELLED_MESSAGE =
  'Enregistrement interrompu : l’appareil n’a pas confirmé. Réessayez quand vous êtes prêt.'

async function postJson(path: string, body: unknown): Promise<Response | undefined> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => undefined)
}

/** Lit un corps JSON. Un corps illisible vaut « absent » : l'appelant décide quoi en dire. */
async function readJson<T>(response: Response): Promise<T | undefined> {
  return (await response.json().catch(() => undefined)) as T | undefined
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await readJson<{ error?: unknown }>(response)
  return typeof body?.error === 'string' ? body.error : fallback
}

const UNREACHABLE = { outcome: 'unreachable', message: UNREACHABLE_MESSAGE } as const

export async function startTotpEnrollment(): Promise<TotpStart> {
  const response = await postJson('/api/auth/mfa/enroll', {})
  if (!response) return UNREACHABLE

  // Un 5xx n'est pas un refus — même règle que le reste du client : peindre « refusé » pendant une
  // panne ferait croire à l'opérateur que son compte est en cause.
  if (response.status >= 500) return UNREACHABLE

  if (!response.ok) {
    const message = await readErrorMessage(response, 'Enrôlement refusé.')
    return response.status === 409
      ? { outcome: 'already_enrolled', message }
      : { outcome: 'refused', message }
  }

  const body = await readJson<{ secret?: string; otpauth_uri?: string }>(response)

  // Sans secret ni URI, il n'y a rien à afficher — et surtout rien à scanner. Le dire comme une
  // panne plutôt que de peindre un QR code vide.
  if (!body?.secret || !body.otpauth_uri) return UNREACHABLE

  return { outcome: 'started', secret: body.secret, uri: body.otpauth_uri }
}

export async function confirmTotpEnrollment(code: string): Promise<TotpConfirmation> {
  const response = await postJson('/api/auth/mfa/enroll', { code })
  if (!response) return UNREACHABLE
  if (response.status >= 500) return UNREACHABLE

  if (!response.ok) {
    const message = await readErrorMessage(response, 'Vérification refusée.')
    // 409 sur la confirmation signifie « plus aucun enrôlement en cours » : le secret affiché est
    // périmé, et retaper un code ne servirait à rien. L'écran doit relancer, pas insister.
    return response.status === 409
      ? { outcome: 'expired', message }
      : { outcome: 'refused', message }
  }

  const body = await readJson<{ recovery_codes?: readonly string[] }>(response)

  return { outcome: 'activated', recoveryCodes: body?.recovery_codes ?? [] }
}

/**
 * Traduit un échec de cérémonie navigateur.
 *
 * `NotAllowedError` couvre l'abandon sous toutes ses formes — fenêtre fermée, délai écoulé,
 * biométrie refusée — et n'est pas une panne. Le reste (`SecurityError` sur une origine ou un `rpID`
 * mal déployés, contexte non sécurisé) est une erreur d'exploitation : conserver le nom technique
 * est la seule chose qui la rende diagnosticable, et il ne porte aucune donnée.
 */
function ceremonyFailure(error: unknown): PasskeyRegistration {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return { outcome: 'cancelled', message: PASSKEY_CANCELLED_MESSAGE }
  }

  const name = error instanceof Error ? error.name : 'erreur inconnue'
  return {
    outcome: 'refused',
    message: `Enregistrement impossible sur cet appareil (${name}). Signalez ce code à l’exploitation.`,
  }
}

export async function registerPasskey(name: string): Promise<PasskeyRegistration> {
  const started = await postJson('/api/auth/mfa/passkey/register', {})
  if (!started) return UNREACHABLE
  if (started.status >= 500) return UNREACHABLE

  if (!started.ok) {
    return { outcome: 'refused', message: await readErrorMessage(started, 'Ajout refusé.') }
  }

  const payload = await readJson<{ options?: PublicKeyCredentialCreationOptionsJSON }>(started)
  if (!payload?.options) return UNREACHABLE

  const attestation = await startRegistration({ optionsJSON: payload.options }).catch(
    (error: unknown) => ceremonyFailure(error),
  )
  if ('outcome' in attestation) return attestation

  // Le nom voyage **avec** la réponse signée. Le poser dans un second appel ouvrirait une fenêtre où
  // l'appareil existe sans libellé, et l'opérateur qui en a plusieurs ne saurait plus lequel retirer.
  const finished = await postJson('/api/auth/mfa/passkey/register', {
    response: attestation,
    name,
  })
  if (!finished) return UNREACHABLE
  if (finished.status >= 500) return UNREACHABLE

  if (!finished.ok) {
    return { outcome: 'refused', message: await readErrorMessage(finished, 'Ajout refusé.') }
  }

  const body = await readJson<{ passkeys?: readonly Passkey[] }>(finished)
  return { outcome: 'registered', passkeys: body?.passkeys ?? [] }
}

/**
 * La liste des appareils.
 *
 * Rend une liste vide quand le serveur ne répond pas, plutôt qu'une issue à peindre : cette liste est
 * un **confort**, et une panne d'affichage ne doit pas empêcher d'enrôler. C'est le seul appel de ce
 * module qui se tait, et c'est délibéré.
 */
export async function listPasskeys(): Promise<readonly Passkey[]> {
  const response = await fetch('/api/auth/mfa/passkeys', {
    headers: { accept: 'application/json' },
  }).catch(() => undefined)

  if (!response?.ok) return []

  return (await readJson<{ passkeys?: readonly Passkey[] }>(response))?.passkeys ?? []
}

async function manage(body: Record<string, unknown>): Promise<PasskeyUpdate> {
  const response = await postJson('/api/auth/mfa/passkeys/manage', body)
  if (!response) return UNREACHABLE
  if (response.status >= 500) return UNREACHABLE

  if (!response.ok) {
    return { outcome: 'refused', message: await readErrorMessage(response, 'Opération refusée.') }
  }

  const payload = await readJson<{ passkeys?: readonly Passkey[] }>(response)
  return { outcome: 'updated', passkeys: payload?.passkeys ?? [] }
}

export function renamePasskey(credentialId: string, name: string): Promise<PasskeyUpdate> {
  return manage({ credential_id: credentialId, name })
}

/**
 * Retire un appareil.
 *
 * **Aucun champ `name`, pas même vide** : le point d'entrée décide d'après sa seule présence, et un
 * nom vide renommerait l'appareil au lieu de le retirer.
 */
export function revokePasskey(credentialId: string): Promise<PasskeyUpdate> {
  return manage({ credential_id: credentialId })
}
