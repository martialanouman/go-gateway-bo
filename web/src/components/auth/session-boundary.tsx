/**
 * Ce qu'un écran gardé peint quand la session n'est **pas décidable**.
 *
 * ## Deux états, deux copies, et une leçon
 *
 * `unknown` (la réponse n'est pas là) et `unavailable` (elle ne viendra pas) ont longtemps été
 * confondus avec « aucune session ». Chacun a produit son défaut : la coquille restait muette pour
 * toujours quand `/auth/me` tombait, et l'écran de vérification renvoyait au login — d'où un
 * va-et-vient entre les deux écrans à chaque hoquet du serveur, chaque tour consommant une tentative
 * du compteur anti-brute-force, pour une panne dont l'opérateur n'est pas responsable.
 *
 * ## Pourquoi un composant, et pas trois `if` recopiés
 *
 * Trois écrans gardent une session — la coquille, la racine, le second facteur. Les trois branches
 * écrites trois fois auraient divergé, comme la règle de redirection avant elles. Et un composant
 * sans routeur **se teste sans routeur** : les états d'attente et de panne se montent en deux lignes,
 * là où les atteindre à travers l'arbre de routes demandait un `fetch` suspendu qui bloquait le
 * runner.
 */

import type { ReactNode } from 'react'
import { ErrorState, Loading } from '~/components/states'
import type { SessionStatus } from './session-gate'

export type SessionBoundaryProps = {
  readonly status: SessionStatus
  /** Refait la requête. Voir `useSessionStatus` : « Réessayer » ne recharge pas la page. */
  readonly retry: () => void
  /** Libellé du squelette, propre à l'écran : « Ouverture de la console », « Chargement… ». */
  readonly label: string
  readonly rows?: number
  /**
   * Rendu seulement quand la session est décidée.
   *
   * Optionnel : deux écrans n'appellent cette frontière **que** pour peindre l'attente et la panne,
   * la suite étant une redirection. Les obliger à passer un enfant mort n'aurait rien clarifié.
   */
  readonly children?: ReactNode
}

export function SessionBoundary({
  status,
  retry,
  label,
  rows = 4,
  children,
}: SessionBoundaryProps) {
  if (status === 'unknown') return <Loading label={label} rows={rows} />

  // `status={0}` : la requête n'a pas abouti au sens où l'opérateur l'entend — `ErrorState` en tire
  // « la passerelle n'a pas répondu », qui est vrai pour une coupure comme pour un 502.
  if (status === 'unavailable') return <ErrorState onRetry={retry} status={0} />

  return children
}
