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
 * globale n'a d'effet que si le module qui la pose a été chargé, ce que rien ne garantit dans un
 * bundle qui élague — le `sideEffects` de `web/package.json` ne déclare que les CSS. Un import pour
 * l'effet de bord serait une promesse que le build peut retirer en silence.
 */
export function refusalInFrench(issue: z.core.$ZodRawIssue): string {
  switch (issue.code) {
    // Un champ que le formulaire n'a pas rempli du tout — pas une saisie trop courte, mais une
    // valeur absente. Le message dit le geste, pas l'état : c'est la règle de rédaction de Google.
    case 'invalid_type':
      return 'Renseignez ce champ.'

    case 'too_big':
      return `Cette saisie est trop longue : le serveur en accepte ${issue.maximum} caractères au plus.`

    case 'too_small':
      return `Cette saisie est trop courte : le serveur en attend ${issue.minimum} caractères au moins.`

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
 * Le pont entre un schéma Zod et React Hook Form, avec la rédaction française attachée.
 *
 * Les écrans passent par ici plutôt que par `zodResolver` nu : l'oubli de l'option de rédaction est
 * silencieux — le formulaire marche, et rend ses refus en anglais.
 */
export function formResolver<Schema extends z.ZodType<unknown, FieldValues>>(schema: Schema) {
  return zodResolver(schema, { error: refusalInFrench })
}
