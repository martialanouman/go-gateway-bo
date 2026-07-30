/**
 * Les cinq états de contenu (step-042).
 *
 * Cinq composants et pas un seul avec un `variant` : la charte demande **cinq copies distinctes**,
 * et un paramètre aurait invité à en réutiliser une pour un cas voisin. La séparation est ce qui
 * empêche « module désactivé » de finir rendu comme une erreur.
 */

export { Empty, type EmptyProps } from './empty'
export { ErrorState, type ErrorStateProps } from './error-state'
export { Loading, type LoadingProps } from './loading'
export { ModuleDisabled, type ModuleDisabledProps } from './module-disabled'
export { NoResults, type NoResultsProps } from './no-results'
