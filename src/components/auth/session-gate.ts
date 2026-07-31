/**
 * La décision de garde, isolée : **une seule règle, deux endroits qui l'appliquent**.
 *
 * ## Pourquoi deux endroits
 *
 * Le `beforeLoad` de la coquille suffit pour une navigation interne — il refuse la route avant même
 * de monter l'écran. Il ne suffit pas pour une **ouverture directe d'URL** : le rendu serveur ne peut
 * pas lire le cookie `HttpOnly` d'un `fetch` relatif, et le routeur ne rejoue pas `beforeLoad` à
 * l'hydratation puisque la route est déjà résolue. La garde ne s'exécutait donc jamais sur le cas le
 * plus courant — un opérateur qui colle une URL — et c'est `e2e/connexion.spec.ts` qui l'a montré,
 * après que trois tests de route l'ont déclarée verte.
 *
 * D'où le second point d'application, dans le composant. Et d'où ce module : deux applications d'une
 * règle écrite deux fois finiraient par diverger, et c'est toujours la plus permissive qui survit.
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
