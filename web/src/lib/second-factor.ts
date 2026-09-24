import { z } from 'zod'
import { refusalCode, refusalMessage } from './api'
import { MfaVerification } from './contract.gen'

/**
 * Ce que les deux écrans qui présentent un code TOTP opposent à la saisie.
 *
 * `.unwrap()` parce que le contrat déclare `code` **facultatif** : une assertion de clé d'accès n'en
 * porte aucun, et le serveur exige l'un ou l'autre selon la méthode. Ces formulaires-ci ne présentent
 * que la voie TOTP, où le code est requis — c'est l'écran qui le sait, pas le contrat.
 *
 * Les bornes restent celles du contrat : `minLength: 1`, `maxLength: 64`. **Rien ici n'exige six
 * chiffres** : le `maxLength` du champ borne la saisie en haut, et le schéma se contente d'un
 * caractère. C'est délibéré — un code de récupération en fait onze, et la voie s'ouvrira dans le
 * même formulaire ; un `length(6)` écrit aujourd'hui serait à défaire.
 */
export const totpAttempt = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Saisissez le code à six chiffres.')
    .pipe(MfaVerification.shape.code.unwrap()),
})

/**
 * Le refus d'un code TOTP, rédigé **ici** et non repris du serveur. `invalid_second_factor` sert les
 * trois méthodes, donc le serveur ne peut ni dire « code » ni parler d'horloge ; cet écran sait qu'il
 * présente un code, et c'est la seule piste d'un opérateur dont le téléphone a dérivé.
 */
const REFUSED_CODE =
  'Code refusé. Vérifiez-le et réessayez ; si le refus persiste, l’heure du téléphone est peut-être décalée de plus d’une minute.'

export const CHALLENGE_LOST =
  'Cette vérification a expiré : ce que la connexion avait ouvert n’est plus en mémoire. Recommencez la connexion.'

/**
 * Le message rendu à l'opérateur, pris **du serveur** sauf pour un code TOTP refusé.
 *
 * La substitution ne vaut **que** sur le chemin TOTP et sur la seule cause qui s'y prête : le
 * verrouillage et la panne gardent la phrase du serveur, qui porte la durée restante ou la réalité
 * HTTP — l'heure du téléphone n'y est pour rien.
 */
export function verificationRefusal(error: unknown, status: number, method: 'totp' | 'webauthn') {
  const fromServer = refusalMessage(
    error,
    `La vérification n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`,
  )

  if (method !== 'totp' || refusalCode(error) !== 'invalid_second_factor') return fromServer

  return REFUSED_CODE
}
