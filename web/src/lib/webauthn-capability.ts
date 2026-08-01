/**
 * Ce que l'appareil de l'opérateur sait faire — et donc quel facteur lui proposer d'abord.
 *
 * ## Pourquoi côté client, et pourquoi ici
 *
 * Le serveur ne peut pas le savoir : aucun en-tête ne dit « ce poste a un lecteur d'empreinte ». Seul
 * le navigateur répond, et il répond à une question précise. Ce module vit donc dans `src/lib/`, la
 * moitié partagée sans secret, et **ne contient aucune garde** : la détection décide de l'ordre
 * d'affichage, jamais de ce qui est accepté. Un appareil qui prétendrait tout savoir faire ne gagnerait
 * rien — c'est la cérémonie côté serveur qui tranche (invariant c).
 *
 * ## Deux questions, pas une
 *
 * `browserSupportsWebAuthn()` dit si l'API existe. Cela ne dit pas qu'un facteur est *utilisable* : un
 * navigateur de bureau sans lecteur biométrique la présente aussi, et proposer la passkey en premier y
 * mènerait à une invite que l'opérateur ne peut pas satisfaire.
 * `platformAuthenticatorIsAvailable()` répond à la seconde question, et c'est elle qui décide de
 * l'ordre.
 *
 * L'échec de l'une comme de l'autre se lit comme « proposer le TOTP », jamais comme une erreur :
 * l'opérateur doit pouvoir entrer avec le facteur qu'il détient, même sur un poste que nous ne savons
 * pas interroger.
 */

import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser'

export type PasskeyCapability =
  /** L'appareil porte un authentificateur intégré : proposer la passkey en premier. */
  | 'platform'
  /** L'API existe, mais sans authentificateur intégré — une clé externe reste possible. */
  | 'external-only'
  /** Rien à proposer : l'interface va droit au TOTP. */
  | 'unsupported'

/**
 * La capacité de l'appareil courant.
 *
 * **Ne lève jamais.** Un navigateur qui refuse la question — politique d'entreprise, contexte non
 * sécurisé, implémentation partielle — doit mener au TOTP, pas à un écran en erreur.
 */
export async function detectPasskeyCapability(): Promise<PasskeyCapability> {
  try {
    if (!browserSupportsWebAuthn()) return 'unsupported'

    return (await platformAuthenticatorIsAvailable()) ? 'platform' : 'external-only'
  } catch {
    return 'unsupported'
  }
}

/**
 * Faut-il proposer la passkey avant le code à six chiffres ?
 *
 * Oui dès qu'un authentificateur est atteignable, intégré ou non : c'est le facteur que la
 * spécification recommande, et le seul qui résiste au hameçonnage. Le TOTP reste offert en repli, sans
 * qu'il faille le chercher — un opérateur dont le téléphone est déchargé ne doit pas rester dehors.
 */
export function shouldOfferPasskeyFirst(capability: PasskeyCapability): boolean {
  return capability !== 'unsupported'
}
