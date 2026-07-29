/**
 * WebAuthn : la configuration de la partie vérifiante, et les quatre cérémonies.
 *
 * Ce module ne connaît ni la base, ni les sessions. Il produit des options à envoyer au navigateur et
 * vérifie ce qu'il renvoie. Tout ce qui se décide — quel opérateur, quel défi, quel authentificateur,
 * et le droit de retirer le dernier facteur — vit dans `mfa-webauthn.ts`.
 *
 * ## `rpID` et `origin` sont la résistance au hameçonnage, pas un réglage de confort
 *
 * C'est le seul endroit du produit où une valeur trop permissive **annule** une garantie
 * cryptographique au lieu de l'affaiblir. Une passkey est liée au domaine qui l'a enregistrée : le
 * navigateur refuse de signer pour un autre. Cette liaison ne vaut que si le serveur vérifie ensuite
 * ce pour quoi elle a été signée — d'où `expectedOrigin` et `expectedRPID`, comparés **caractère pour
 * caractère** à ce que le navigateur annonce.
 *
 * Les deux viennent donc de l'environnement, sans valeur par défaut, et sont validées au démarrage :
 * une origine approximative ne « marche pas à peu près », elle refuse tout — et l'échec ressemble
 * alors à un problème d'appareil, pas à une erreur de déploiement.
 *
 * ## Ce que la validation refuse, et pourquoi
 *
 * - une origine qui n'est pas une URL `https` absolue — sauf `localhost`, que la spécification traite
 *   comme sûre parce qu'un poste de développement n'a pas de certificat ;
 * - un chemin ou une barre finale : WebAuthn compare une *origine*, pas une URL, et un `/` de trop
 *   suffit à ne jamais correspondre ;
 * - un `rpID` qui n'est ni le domaine de l'origine ni l'un de ses parents : le navigateur refuserait,
 *   et croire le contraire reviendrait à déployer un second facteur qui n'a jamais fonctionné.
 */

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'

/**
 * Le nom affiché par l'authentificateur au moment de l'enregistrement.
 *
 * La même valeur que l'émetteur TOTP : c'est le même produit, et deux libellés différents dans le
 * gestionnaire de passkeys d'un opérateur se liraient comme deux comptes.
 */
const RP_NAME = 'Passerelle SMS'

export type WebAuthnConfig = {
  readonly rpId: string
  readonly origin: string
  readonly rpName: string
}

/** Un authentificateur enregistré, tel que ce module a besoin de le lire. */
export type StoredCredential = {
  readonly id: string
  /** Clé **publique**, en base64url. Aucune clé privée ne quitte jamais l'appareil. */
  readonly publicKey: string
  readonly counter: number
  readonly transports?: readonly AuthenticatorTransportFuture[]
}

export function readWebAuthnConfig(env: NodeJS.ProcessEnv): WebAuthnConfig {
  const rpId = env.AUTH_WEBAUTHN_RP_ID?.trim()
  if (!rpId) {
    throw new Error(
      "AUTH_WEBAUTHN_RP_ID est requise : c'est le domaine auquel les passkeys sont liées.",
    )
  }

  const origin = env.AUTH_WEBAUTHN_ORIGIN?.trim()
  if (!origin) {
    throw new Error(
      "AUTH_WEBAUTHN_ORIGIN est requise : c'est l'origine exacte que le navigateur annoncera.",
    )
  }

  const parsed = parseOrigin(origin)
  if (!parsed) {
    throw new Error(
      `AUTH_WEBAUTHN_ORIGIN doit être une origine https absolue, sans chemin ni barre finale (http n'est admis que pour localhost) : « ${origin} » ne l'est pas.`,
    )
  }

  if (!coversHost(rpId, parsed.hostname)) {
    throw new Error(
      `AUTH_WEBAUTHN_RP_ID doit être le domaine de AUTH_WEBAUTHN_ORIGIN ou l'un de ses parents : « ${rpId} » ne couvre pas « ${parsed.hostname} ».`,
    )
  }

  return { rpId, origin, rpName: RP_NAME }
}

/** L'origine décomposée, ou `undefined` si elle n'a pas la forme qu'attend WebAuthn. */
function parseOrigin(origin: string): { readonly hostname: string } | undefined {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return undefined
  }

  // WebAuthn compare une origine : schéma, hôte et port, et rien de plus.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined
  if (origin.endsWith('/')) return undefined

  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) return undefined

  return { hostname: url.hostname }
}

/** `rpID` doit être l'hôte lui-même ou l'un de ses domaines parents. */
function coversHost(rpId: string, hostname: string): boolean {
  return hostname === rpId || hostname.endsWith(`.${rpId}`)
}

/**
 * Les options d'enregistrement d'un nouvel authentificateur.
 *
 * `excludeCredentials` porte ceux déjà enregistrés : sans lui, un opérateur réenregistrerait le même
 * appareil sans s'en rendre compte et croirait détenir deux facteurs là où il n'en a qu'un.
 */
export function registrationOptions(
  config: WebAuthnConfig,
  operator: { readonly id: string; readonly email: string },
  existing: readonly StoredCredential[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: new TextEncoder().encode(operator.id),
    userName: operator.email,
    // Aucune attestation demandée : elle n'apporterait qu'un modèle d'appareil, au prix d'une
    // invite supplémentaire pour l'opérateur et d'une donnée à conserver dont personne ne fait rien.
    attestationType: 'none',
    excludeCredentials: existing.map((credential) => ({
      id: credential.id,
      transports: credential.transports ? [...credential.transports] : undefined,
    })),
    authenticatorSelection: {
      // `preferred` et non `required` : exiger une clé résidente écarterait des clés de sécurité
      // parfaitement valables, et c'est la vérification de l'utilisateur qui porte la garantie.
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })
}

export type RegistrationOutcome =
  | { readonly verified: true; readonly credential: StoredCredential }
  | { readonly verified: false }

/**
 * Vérifie une réponse d'enregistrement. **Ne lève jamais** : la bibliothèque signale par une exception
 * un défi qui ne correspond pas, une origine inattendue ou une signature invalide — c'est-à-dire le
 * cas ordinaire d'un refus, qui ne doit pas remonter en erreur serveur.
 */
export async function verifyRegistration(
  config: WebAuthnConfig,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<RegistrationOutcome> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
    })

    if (!result.verified || !result.registrationInfo) return { verified: false }

    const { credential } = result.registrationInfo
    return {
      verified: true,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports,
      },
    }
  } catch {
    return { verified: false }
  }
}

/**
 * Les options d'authentification.
 *
 * `allowCredentials` liste les authentificateurs de l'opérateur — on sait qui s'authentifie, le mot de
 * passe ayant déjà été présenté. Le laisser vide obligerait le navigateur à proposer toutes les
 * passkeys du poste, y compris celles d'un autre compte.
 */
export function authenticationOptions(
  config: WebAuthnConfig,
  credentials: readonly StoredCredential[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: 'preferred',
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports ? [...credential.transports] : undefined,
    })),
  })
}

export type AuthenticationOutcome =
  | { readonly verified: true; readonly credentialId: string; readonly newCounter: number }
  | { readonly verified: false }

/**
 * Vérifie une réponse d'authentification et rend le **nouveau compteur de signature**.
 *
 * Le compteur est la détection de clonage de la spécification : un authentificateur qui l'incrémente
 * à chaque usage trahit une copie de lui-même si la valeur cesse de progresser. La bibliothèque refuse
 * elle-même une valeur qui n'a pas progressé ; c'est à l'appelant de la **conserver**, sans quoi la
 * garde ne compare rien.
 */
export async function verifyAuthentication(
  config: WebAuthnConfig,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  credential: StoredCredential,
): Promise<AuthenticationOutcome> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
        counter: credential.counter,
        transports: credential.transports ? [...credential.transports] : undefined,
      },
    })

    return result.verified
      ? {
          verified: true,
          credentialId: result.authenticationInfo.credentialID,
          newCounter: result.authenticationInfo.newCounter,
        }
      : { verified: false }
  } catch {
    return { verified: false }
  }
}
