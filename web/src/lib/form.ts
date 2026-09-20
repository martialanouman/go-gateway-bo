import { zodResolver } from '@hookform/resolvers/zod'
import type { FieldValues } from 'react-hook-form'
import type { z } from 'zod'

/**
 * Ce que Zod refuse, rédigé en français.
 *
 * **Le nombre vient du refus, jamais de cette fonction.** `iss.maximum` et `iss.minimum` portent la
 * borne que le schéma a opposée — celle du contrat, pour un schéma engendré. Recopier « 4096 » ici
 * en ferait une troisième rédaction, et c'est exactement la dérive que `cmd/zodgen` existe pour
 * fermer.
 *
 * Passé **par appel** plutôt que posé en configuration globale par `z.config()` : une configuration
 * globale n'a d'effet que si le module qui la pose a été chargé, ce que rien ne garantit si elle vit
 * dans un module importé pour son seul effet de bord — le `sideEffects` de `web/package.json` ne
 * déclare que les CSS, donc l'élagage a le droit de le retirer. Le passage par appel ferme la
 * question au lieu de la faire dépendre de l'endroit où la ligne atterrit.
 */
export function refusalInFrench(issue: z.core.$ZodRawIssue): string {
  switch (issue.code) {
    // Un champ que le formulaire n'a pas rempli du tout — pas une saisie trop courte, mais une
    // valeur absente. Le message nomme le geste, comme les cinq refus de champ que step-027 a fait
    // valider : « Saisissez un e-mail. », « Saisissez un mot de passe. » La règle « conséquence
    // d'abord » de `CLAUDE.md` gouverne la copie qui **explique** un refus ; un refus de champ, lui,
    // tient sur une ligne à côté du champ, et l'opérateur y cherche quoi faire.
    case 'invalid_type':
      return 'Renseignez ce champ.'

    // **Aucune attribution au serveur ici.** Elle serait fausse une fois sur deux : `internal/bff/
    // auth.go` ne compare que des **maxima**, et le `minLength: 1` que le contrat pose sur
    // `password` n'y est gardé par rien — un mot de passe vide n'y est pas refusé en 400, il part à
    // `Authenticator.Login` et revient en 401. Le message dit donc la borne, pas qui la tient.
    case 'too_big':
      return `Cette saisie est trop longue : ${countOfCharacters(issue.maximum)} au maximum.`

    case 'too_small':
      return `Cette saisie est trop courte : ${countOfCharacters(issue.minimum)} au minimum.`

    case 'invalid_value':
      return 'Cette valeur n’est pas dans la liste attendue.'

    // Le filet, et il n'est pas décoratif. Sans lui, ce que Zod rédige lui-même traverse — **en
    // anglais**, dans un produit dont toute la copie est en français, et sans qu'aucune porte ne le
    // voie. Un message vague en français vaut mieux qu'un message précis que l'opérateur ne lit pas.
    default:
      return 'Cette valeur n’est pas acceptée.'
  }
}

/**
 * « 1 caractère », « 43 caractères ». L'accord n'est pas cosmétique : la borne vient du refus, donc
 * elle vaut 1 pour tout champ dont le contrat exige seulement qu'il ne soit pas vide, et « 1
 * caractères » est alors ce que l'opérateur lit.
 */
function countOfCharacters(count: number | bigint) {
  return `${count} caractère${count > 1 ? 's' : ''}`
}

/**
 * Le pont entre un schéma Zod et React Hook Form, avec la rédaction française attachée.
 *
 * Les écrans passent par ici plutôt que par `zodResolver` nu : l'oubli de l'option de rédaction est
 * silencieux — le formulaire marche, et rend ses refus en anglais.
 */
export function formResolver<Schema extends z.ZodType<unknown, FieldValues>>(schema: Schema) {
  return zodResolver(schema, { error: refusalInFrench })
}
