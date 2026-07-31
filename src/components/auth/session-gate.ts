/**
 * La décision de garde, isolée de son application.
 *
 * Elle est appliquée par le composant de la coquille (`src/routes/_shell.tsx`), et **pas** par un
 * `beforeLoad` : celui-ci ne s'exécute pas sur une ouverture directe d'URL, ce qui laissait entrer
 * sans session — voir l'en-tête de ce fichier-là pour l'histoire complète.
 *
 * Elle vit à part parce qu'elle est la seule chose de la garde qui **décide**. Le reste est du
 * câblage, et une règle mêlée à son câblage ne se teste qu'à travers un routeur monté : les cas
 * qu'on oublie alors sont précisément ceux qui n'arrivent qu'en production.
 */

import type { CurrentOperator } from '~/components/permission'

/** Où renvoyer, ou `undefined` s'il n'y a rien à faire. */
export type SessionRedirect = '/connexion' | '/connexion/verification' | undefined

/**
 * Dit où renvoyer une session, d'après ce que `/auth/me` a répondu.
 *
 * `undefined` en entrée signifie « pas encore connu » et ne renvoie nulle part : rediriger pendant
 * l'attente sortirait de la console un opérateur parfaitement légitime, à chaque rechargement.
 */
export function sessionRedirect(operator: CurrentOperator | null | undefined): SessionRedirect {
  if (operator === undefined) return undefined

  if (operator === null) return '/connexion'

  // Une session partielle ne porte **aucune** permission : la laisser entrer afficherait une console
  // entièrement grisée, sans dire ce qui manque.
  return operator.mfaCompleted ? undefined : '/connexion/verification'
}
