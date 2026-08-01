/**
 * L'échec — **la réalité HTTP, la réassurance, et une issue**.
 *
 * Trois éléments, et le deuxième est celui qu'on oublie : un opérateur qui voit une erreur croit
 * avoir tout perdu. « Vos données locales restent affichées » est donc dans la copie, pas dans
 * l'intention.
 *
 * ## Ce que cet état ne montre jamais
 *
 * **Le message de la passerelle.** Un texte de validation distant cite volontiers la valeur qu'il
 * refuse — « la valeur '…' dépasse 160 caractères » sur un champ de contenu recopierait le corps
 * d'un message à l'écran, puis dans la première capture qu'on colle dans un ticket. Seul le
 * **statut** est rendu, parce qu'il est stable, greppable, et qu'il ne porte aucune donnée
 * (invariant a).
 *
 * C'est le seul des cinq états à porter `role="alert"` : lui seul demande une réaction.
 */

import { Button } from '../primitives'

export type ErrorStateProps = {
  /** Statut HTTP. `0` quand la requête n'a jamais abouti — DNS, TLS, réseau. */
  readonly status: number
  /** Absent quand rien ne permet de reprendre : ne pas promettre ce qui n'aboutira pas. */
  readonly onRetry?: () => void
  readonly className?: string
}

/** Ce que le statut veut dire pour un opérateur, sans jargon et sans texte distant. */
function meaning(status: number): string {
  if (status === 0) return 'la passerelle n’a pas répondu'
  if (status === 403) return 'cette action vous est refusée'
  if (status === 404) return 'cette ressource n’existe plus'
  if (status === 429) return 'trop de requêtes en peu de temps'
  if (status >= 500) return 'la passerelle est en difficulté'
  return 'la requête a été refusée'
}

export function ErrorState({ status, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={['ui-state', 'ui-state--error', className].filter(Boolean).join(' ')}
      role="alert"
    >
      <p className="ui-state__title">
        Chargement interrompu — <span className="ui-state__status">{status}</span>,{' '}
        {meaning(status)}
      </p>
      <p className="ui-state__body">
        Vos données locales restent affichées : rien n’a été perdu ni modifié.
      </p>
      {onRetry ? <Button onClick={onRetry}>Réessayer</Button> : null}
    </div>
  )
}
