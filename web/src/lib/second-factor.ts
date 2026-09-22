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
 * L'indice que `step-035` a retiré du serveur.
 *
 * `invalid_second_factor` sert les trois méthodes — TOTP, code de récupération, clé d'accès — et
 * disait « vérifier l'heure de l'application d'authentification » à qui venait de présenter une
 * clé. Le serveur ne le dit donc plus. **Un écran, lui, sait quelle méthode il présente**, et c'est
 * ce qui lui permet de le dire sans mentir : sans cette reprise, un opérateur dont le téléphone a
 * dérivé n'a plus aucune piste.
 */
const CLOCK_HINT =
  'Si le code est refusé plusieurs fois de suite, vérifiez l’heure de l’application d’authentification : le serveur tolère environ une minute d’écart, et refuse les codes au-delà.'

export const CHALLENGE_LOST =
  'Cette vérification a expiré : ce que la connexion avait ouvert n’est plus en mémoire. Reprenez la connexion.'

/**
 * Le message rendu à l'opérateur, pris **du serveur**, augmenté de ce que le serveur ne peut pas
 * dire.
 *
 * Le BFF rédige ses refus en français et ne nomme pas laquelle des cinq causes s'applique — les
 * distinguer dirait à une machine où elle en est.
 *
 * L'indice d'horloge n'est ajouté **que** sur le chemin TOTP, et sur la seule cause qui s'y prête :
 * ajouté partout, il redeviendrait ce que step-035 a retiré. Conditionné à la méthode seule, il se
 * collait aussi au verrouillage et à la panne — « réessayez dans cinq minutes » suivi de « vérifiez
 * l'heure de votre téléphone », qui n'y est pour rien.
 */
export function verificationRefusal(error: unknown, status: number, method: 'totp' | 'webauthn') {
  const fromServer = refusalMessage(
    error,
    `La vérification n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`,
  )

  if (method !== 'totp' || refusalCode(error) !== 'invalid_second_factor') return fromServer

  return `${fromServer} ${CLOCK_HINT}`
}
