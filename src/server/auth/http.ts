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

// **Ces deux types existent aussi dans `lib.dom.d.ts`**, sous le même nom et avec des champs plus
// larges (`transports: string[]`, `authenticatorAttachment: string`). Sans cet import explicite, ce
// fichier compile contre les types globaux du DOM et rend des valeurs que la bibliothèque refuse à la
// frontière — une erreur qui n'apparaît que chez l'appelant, jamais ici.
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import {
  clearedSessionCookie,
  SESSION_COOKIE_NAME,
  type SessionSecrets,
  sessionCookieAttributes,
  signSessionId,
} from './cookie'
import type { LoginOutcome } from './login'
import type { CurrentOperator } from './me'
import type { EnrollmentConfirmation, EnrollmentStart, MfaVerification } from './mfa'
import type {
  PasskeyAuthentication,
  PasskeyAuthenticationStart,
  PasskeyRegistrationFinish,
  PasskeyRegistrationStart,
  PasskeyRevocation,
  PublicCredential,
} from './mfa-webauthn'
import { ABSOLUTE_LIFETIME_MS } from './session'

/**
 * Durée de vie du cookie, en secondes — **déduite** du plafond absolu, jamais réécrite.
 *
 * Le cookie n'est qu'un porteur : le laisser survivre à ce qu'il désigne n'apporte rien qu'une
 * reconnexion silencieuse de plus, et deux constantes écrites séparément finissent toujours par dire
 * deux choses. La base reste l'autorité — un cookie encore présent sur une session révoquée ne vaut
 * rien — mais il ne doit pas pour autant promettre une session qui n'existe plus.
 */
const COOKIE_MAX_AGE_SECONDS = ABSOLUTE_LIFETIME_MS / 1000

/** Le seul message d'échec de connexion. Il ne dit pas ce qui a échoué, parce qu'il ne le doit pas. */
export const INVALID_CREDENTIALS_MESSAGE =
  'Connexion refusée : identifiant ou mot de passe incorrect.'

const RATE_LIMITED_MESSAGE =
  'Connexion refusée : trop de tentatives depuis cette adresse. Réessayez plus tard.'

/**
 * `secrets` n'est pas optionnel, et ne doit pas le redevenir : sans clé, cette fonction rendrait un
 * succès sans cookie — un opérateur authentifié qui ne peut pas poursuivre, et une session ouverte en
 * base que plus rien ne désigne. Le rendre requis fait disparaître la branche plutôt que de la
 * documenter.
 */
export function loginResponse(outcome: LoginOutcome, secrets: SessionSecrets): Response {
  if (outcome.outcome === 'mfa_required') {
    // **Pas d'identifiant d'opérateur, ni d'identifiant de session dans le corps** : les rendre au
    // navigateur sortirait du `HttpOnly`, donc les mettrait à portée d'un script injecté. Le lien
    // avec la vérification du second facteur passe entièrement par le cookie.
    const cookie = `${SESSION_COOKIE_NAME}=${signSessionId(outcome.sessionId, secrets)}; ${sessionCookieAttributes(COOKIE_MAX_AGE_SECONDS)}`

    return json({ mfa_required: true }, 200, { 'set-cookie': cookie })
  }

  if (outcome.outcome === 'rate_limited') {
    return json({ error: RATE_LIMITED_MESSAGE }, 429, {
      'retry-after': String(outcome.retryAfterSeconds),
    })
  }

  return json({ error: INVALID_CREDENTIALS_MESSAGE }, 401)
}

/** Le seul message de session absente. Comme pour la connexion, il ne dit pas ce qui manque. */
export const SESSION_ABSENT_MESSAGE = 'Session absente ou expirée.'

/**
 * `GET /auth/me` — l'opérateur courant, ou un refus qui ne renseigne pas.
 *
 * Cookie absent, signature invalide, session révoquée, échue, inactive, ou opérateur désactivé : la
 * même réponse. Le client n'a qu'une conduite à tenir — aller au login — et distinguer les cas ne
 * l'aiderait pas, alors que cela renseignerait qui sonde.
 */
export function meResponse(me: CurrentOperator | undefined): Response {
  return me ? json(me, 200) : json({ error: SESSION_ABSENT_MESSAGE }, 401)
}

/**
 * `POST /auth/logout` — **toujours 204, toujours le cookie effacé**.
 *
 * Répondre différemment selon qu'il y avait une session indiquerait à l'appelant s'il en détenait
 * une. Et effacer inconditionnellement évite qu'un cookie périmé reste collé au navigateur après une
 * révocation décidée côté serveur.
 */
export function logoutResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': clearedSessionCookie(), 'cache-control': 'no-store' },
  })
}

/**
 * Le seul message de code refusé.
 *
 * Code faux, hors fenêtre de dérive, rejoué, code de récupération déjà consommé, ou aucun facteur
 * actif : le même 401 et le même texte. Distinguer renseignerait sur l'état du compte — et, pour le
 * rejeu, dirait à un attaquant que le code qu'il a intercepté **était** le bon.
 */
export const INVALID_MFA_CODE_MESSAGE = 'Vérification refusée : code incorrect ou expiré.'

/**
 * Le verrou du second facteur **s'annonce**, contrairement à celui de la connexion.
 *
 * Ce point d'entrée n'est atteignable qu'avec une session déjà ouverte par un mot de passe valide :
 * celui qui reçoit ce refus sait déjà que le compte existe. Lui cacher l'échéance ne le ferait que
 * réessayer en vain.
 */
export const MFA_RATE_LIMITED_MESSAGE =
  'Vérification suspendue : trop de tentatives sur ce compte. Réessayez plus tard.'

/**
 * Refus de réenrôlement, avec la conduite à tenir.
 *
 * « Refusé » sans suite laisserait un opérateur au téléphone perdu sans issue visible, et pousserait
 * à chercher un contournement. Le remplacement est une opération administrative (step-027).
 */
export const ALREADY_ENROLLED_MESSAGE =
  'Enrôlement refusé : un authentificateur est déjà associé à ce compte. Son remplacement passe par un administrateur.'

/**
 * Refus d'enrôlement à qui détient déjà un facteur, sans avoir franchi le sien.
 *
 * Distinct d'`ALREADY_ENROLLED_MESSAGE`, qui renvoie vers un administrateur : ici l'opérateur n'a
 * besoin de personne. Il détient une passkey, il lui suffit de la présenter — sa session devient
 * complète, et il peut alors ajouter une application authenticator. Lui parler d'administrateur
 * l'enverrait à la mauvaise porte, et pousserait à chercher un contournement.
 */
export const MFA_ENROLL_REQUIRED_MESSAGE =
  'Enrôlement refusé : franchissez d’abord le second facteur que vous détenez déjà pour en ajouter un autre.'

export const NO_PENDING_ENROLLMENT_MESSAGE =
  'Aucun enrôlement en cours : relancez l’enrôlement pour obtenir un nouveau QR code.'

/**
 * `POST /auth/mfa/enroll` — les deux phases de l'enrôlement partagent une réponse.
 *
 * **Le secret et l'URI ne sortent qu'ici**, au démarrage, et les codes de récupération qu'à la
 * confirmation. Aucune autre réponse de ce dépôt ne les porte, et aucune ne les portera : c'est
 * l'invariant (b), et il n'a pas d'exception « pour déboguer ».
 */
export function mfaEnrollResponse(outcome: EnrollmentStart | EnrollmentConfirmation): Response {
  switch (outcome.outcome) {
    case 'started':
      return json({ secret: outcome.secret, otpauth_uri: outcome.uri }, 200)

    case 'activated':
      // `mfa_completed` comme la vérification : la confirmation promeut la session, et le client n'a
      // pas à savoir par quelle porte il est entré.
      return json({ mfa_completed: true, recovery_codes: outcome.recoveryCodes }, 200)

    case 'already_enrolled':
      return json({ error: ALREADY_ENROLLED_MESSAGE }, 409)

    // 403, comme le refus symétrique côté passkey : dans les deux cas l'opérateur détient déjà un
    // facteur et doit le franchir avant d'en ajouter un autre. Le **message**, lui, diffère — l'un
    // parle d'enregistrer un appareil, l'autre d'ajouter une application authenticator, et
    // l'opérateur a besoin de savoir laquelle des deux opérations vient d'être refusée.
    case 'mfa_required':
      return json({ error: MFA_ENROLL_REQUIRED_MESSAGE }, 403)

    case 'no_pending_enrollment':
      return json({ error: NO_PENDING_ENROLLMENT_MESSAGE }, 409)

    case 'invalid_code':
      return json({ error: INVALID_MFA_CODE_MESSAGE }, 401)

    default:
      return rateLimited(outcome.retryAfterSeconds)
  }
}

/** `POST /auth/mfa/verify` — le second facteur passé, ou un refus qui ne renseigne pas. */
export function mfaVerifyResponse(outcome: MfaVerification): Response {
  if (outcome.outcome === 'completed') {
    return json(
      outcome.recovery
        ? { mfa_completed: true, recovery_codes_remaining: outcome.recovery.remaining }
        : { mfa_completed: true },
      200,
    )
  }

  if (outcome.outcome === 'rate_limited') return rateLimited(outcome.retryAfterSeconds)

  return json({ error: INVALID_MFA_CODE_MESSAGE }, 401)
}

function rateLimited(retryAfterSeconds: number): Response {
  return json({ error: MFA_RATE_LIMITED_MESSAGE }, 429, {
    'retry-after': String(retryAfterSeconds),
  })
}

/**
 * Longueur maximale d'un code présenté.
 *
 * Six chiffres pour un TOTP, onze caractères pour un code de récupération formaté. La borne est
 * large pour absorber les espaces d'un copier-coller, et bornée parce que la saisie sert de clé de
 * recherche : rien n'oblige à hacher un mégaoctet pour répondre « non ».
 */
const MAX_CODE_LENGTH = 64

export type ParsedMfaCode = { readonly ok: true; readonly code: string } | { readonly ok: false }

/** Lit le code présenté. Un corps illisible se traite **exactement** comme un code faux. */
export function parseMfaCode(body: unknown): ParsedMfaCode {
  const code = readCodeField(body)
  return code === undefined ? { ok: false } : { ok: true, code }
}

export type ParsedEnrollment =
  /** Aucun code présenté : l'opérateur demande un QR code. */
  | { readonly phase: 'start' }
  /** Un code accompagne la demande : c'est la confirmation. */
  | { readonly phase: 'confirm'; readonly code: string }
  /** Un champ `code` est là mais inexploitable — voir le test pour la raison du cas séparé. */
  | { readonly phase: 'invalid' }

/**
 * Distingue les deux phases de l'enrôlement.
 *
 * Un champ `code` présent mais inexploitable ne retombe **pas** sur `start` : cela écraserait le
 * secret d'un enrôlement en cours, et l'opérateur qui vient de scanner son QR code se verrait
 * refusé sans rien pouvoir en déduire.
 */
export function parseEnrollmentBody(body: unknown): ParsedEnrollment {
  if (typeof body !== 'object' || body === null) return { phase: 'start' }
  if (!('code' in body)) return { phase: 'start' }

  const code = readCodeField(body)
  return code === undefined ? { phase: 'invalid' } : { phase: 'confirm', code }
}

function readCodeField(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined

  const { code } = body as Record<string, unknown>
  if (typeof code !== 'string') return undefined

  const trimmed = code.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_CODE_LENGTH ? trimmed : undefined
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

/**
 * Le seul message de cérémonie WebAuthn refusée.
 *
 * Signature invalide, origine inattendue, appareil inconnu, compteur qui n'avance plus : le même 401.
 * Distinguer dirait à qui présente une passkey volée si elle est enrôlée ici, et dirait à qui rejoue si
 * ce qu'il rejoue *était* valide.
 */
export const INVALID_PASSKEY_MESSAGE =
  'Vérification refusée : cet appareil n’a pas pu être vérifié.'

export const NO_PENDING_CEREMONY_MESSAGE =
  'Aucune cérémonie en cours : relancez l’opération depuis cet appareil.'

/**
 * Refus d'ajout depuis une session dont le second facteur n'est pas passé.
 *
 * Le message dit la conduite à tenir plutôt que la règle : l'opérateur doit d'abord franchir le facteur
 * qu'il détient déjà, et c'est ce qui l'autorisera à en ajouter un.
 */
export const PASSKEY_MFA_REQUIRED_MESSAGE =
  'Ajout refusé : franchissez d’abord votre second facteur actuel pour enregistrer un nouvel appareil.'

export const NO_PASSKEY_MESSAGE = 'Aucun appareil enregistré sur ce compte.'

/**
 * Refus de retrait du dernier facteur, avec ce qu'il faut faire à la place.
 *
 * « Refusé » sans suite pousserait à chercher un contournement. Enregistrer un autre appareil, ou
 * enrôler une application authenticator, rend ce retrait possible.
 */
export const LAST_FACTOR_MESSAGE =
  'Retrait refusé : c’est votre dernier second facteur. Enregistrez un autre appareil ou une application authenticator avant de le retirer.'

export const UNKNOWN_PASSKEY_MESSAGE = 'Cet appareil n’est pas enregistré sur ce compte.'

/** `POST /auth/mfa/passkey/register` — les deux phases partagent une réponse. */
export function passkeyRegisterResponse(
  outcome: PasskeyRegistrationStart | PasskeyRegistrationFinish,
): Response {
  switch (outcome.outcome) {
    case 'started':
      // Les options portent le défi : c'est ce que le navigateur doit signer, et il n'y a rien de
      // secret là-dedans — le défi ne vaut que pour la session qui l'a demandé.
      return json({ options: outcome.options }, 200)

    case 'registered':
      return json({ mfa_completed: true, passkeys: outcome.credentials }, 200)

    case 'mfa_required':
      return json({ error: PASSKEY_MFA_REQUIRED_MESSAGE }, 403)

    case 'no_pending_ceremony':
      return json({ error: NO_PENDING_CEREMONY_MESSAGE }, 409)

    default:
      return json({ error: INVALID_PASSKEY_MESSAGE }, 401)
  }
}

/** `POST /auth/mfa/passkey/verify` — les deux phases partagent une réponse. */
export function passkeyVerifyResponse(
  outcome: PasskeyAuthenticationStart | PasskeyAuthentication,
): Response {
  switch (outcome.outcome) {
    case 'started':
      return json({ options: outcome.options }, 200)

    case 'completed':
      return json({ mfa_completed: true }, 200)

    case 'no_passkey':
      // 409 et non 401 : le compte est connu, la session est valide, il n'y a simplement rien à
      // vérifier par ce facteur. L'interface doit alors proposer le TOTP.
      return json({ error: NO_PASSKEY_MESSAGE }, 409)

    case 'no_pending_ceremony':
      return json({ error: NO_PENDING_CEREMONY_MESSAGE }, 409)

    case 'rate_limited':
      return rateLimited(outcome.retryAfterSeconds)

    default:
      return json({ error: INVALID_PASSKEY_MESSAGE }, 401)
  }
}

/** `GET /auth/mfa/passkeys` — la liste, sans clé publique ni compteur. */
export function passkeyListResponse(credentials: readonly PublicCredential[]): Response {
  return json({ passkeys: credentials }, 200)
}

/** `POST /auth/mfa/passkeys/revoke` et le renommage : deux refus, un succès. */
export function passkeyRevokeResponse(outcome: PasskeyRevocation): Response {
  switch (outcome.outcome) {
    case 'revoked':
      return json({ passkeys: outcome.credentials }, 200)

    case 'last_factor':
      return json({ error: LAST_FACTOR_MESSAGE }, 409)

    default:
      return json({ error: UNKNOWN_PASSKEY_MESSAGE }, 404)
  }
}

/** Longueur maximale du nom d'un appareil, alignée sur ce que le magasin conserve. */
const MAX_PASSKEY_NAME_LENGTH = 60

export type ParsedPasskeyRegistration =
  /** Aucune réponse d'authentificateur : l'opérateur demande des options. */
  | { readonly phase: 'start' }
  | {
      readonly phase: 'finish'
      readonly response: RegistrationResponseJSON
      readonly name: string
    }
  | { readonly phase: 'invalid' }

/**
 * Distingue les deux phases de l'enregistrement.
 *
 * La réponse de l'authentificateur n'est **pas** validée en détail ici : c'est le travail de la
 * bibliothèque, qui vérifie la signature. Ce qui est vérifié ici est la forme minimale — un objet avec
 * un `id` — pour ne pas passer n'importe quoi à une cérémonie.
 */
export function parsePasskeyRegistration(body: unknown): ParsedPasskeyRegistration {
  if (typeof body !== 'object' || body === null) return { phase: 'start' }
  if (!('response' in body)) return { phase: 'start' }

  const { response, name } = body as Record<string, unknown>
  if (!isAuthenticatorResponse(response)) return { phase: 'invalid' }

  const label = typeof name === 'string' ? name.trim().slice(0, MAX_PASSKEY_NAME_LENGTH) : ''

  return { phase: 'finish', response: response as RegistrationResponseJSON, name: label }
}

export type ParsedPasskeyAuthentication =
  | { readonly phase: 'start' }
  | { readonly phase: 'finish'; readonly response: AuthenticationResponseJSON }
  | { readonly phase: 'invalid' }

export function parsePasskeyAuthentication(body: unknown): ParsedPasskeyAuthentication {
  if (typeof body !== 'object' || body === null) return { phase: 'start' }
  if (!('response' in body)) return { phase: 'start' }

  const { response } = body as Record<string, unknown>
  if (!isAuthenticatorResponse(response)) return { phase: 'invalid' }

  return { phase: 'finish', response: response as AuthenticationResponseJSON }
}

/** L'identifiant d'un appareil, tel qu'un corps de retrait ou de renommage le porte. */
export function parsePasskeyId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined

  const { credential_id: id } = body as Record<string, unknown>
  if (typeof id !== 'string') return undefined

  const trimmed = id.trim()
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : undefined
}

function isAuthenticatorResponse(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.length > 0
  )
}
