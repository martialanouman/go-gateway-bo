/**
 * « Rien qui corresponde » — distinct de « rien encore ».
 *
 * La confusion entre les deux coûte cher : un opérateur qui lit « aucun client » alors que ses
 * filtres excluent tout va en créer un second, en doublon. La copie parle donc des **filtres**, et
 * l'action propose de les élargir — jamais de créer.
 */

export type NoResultsProps = {
  /** Ce qui a été cherché, si l'écran le sait. Reste en mono : c'est une valeur saisie. */
  readonly query?: string
  readonly onReset?: () => void
  readonly resetLabel?: string
  readonly className?: string
}

import { Button } from '../primitives'

export function NoResults({
  query,
  onReset,
  resetLabel = 'Réinitialiser les filtres',
  className,
}: NoResultsProps) {
  return (
    <div className={['ui-state', 'ui-state--no-results', className].filter(Boolean).join(' ')}>
      <p className="ui-state__title">Aucun résultat</p>
      {/*
        La phrase est rendue d'un bloc quand il n'y a pas de recherche : découpée en morceaux, elle
        se lit correctement à l'écran mais devient introuvable pour qui la cherche par son texte —
        un lecteur d'écran la fragmente aussi.
      */}
      {query ? (
        <p className="ui-state__body">
          Les filtres actuels ne laissent passer aucune ligne pour{' '}
          <span className="ui-state__query">{query}</span>. Élargissez la période ou retirez un
          critère.
        </p>
      ) : (
        <p className="ui-state__body">
          Les filtres actuels ne laissent passer aucune ligne. Élargissez la période ou retirez un
          critère.
        </p>
      )}
      {onReset ? <Button onClick={onReset}>{resetLabel}</Button> : null}
    </div>
  )
}
