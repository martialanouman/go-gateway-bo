/**
 * « Rien encore » — et **comment en créer**.
 *
 * L'état vide sans issue est le plus frustrant du produit : l'opérateur voit un écran nu et ne sait
 * pas si c'est normal, s'il lui manque un droit, ou si quelque chose a échoué. La charte demande
 * donc les deux : ce qui manque, et le geste qui le remplit.
 *
 * Ce n'est **pas** une alerte : il n'y a rien de cassé. Voir `error-state.tsx` pour l'état qui l'est.
 */

import type { ReactNode } from 'react'
import { Button } from '../primitives'

export type EmptyProps = {
  readonly title: string
  /** À quoi sert ce qui manque. Une phrase, conséquence d'abord. */
  readonly description?: ReactNode
  /** Le geste qui remplit l'écran. Absent quand l'opérateur n'a pas le droit de créer. */
  readonly action?: { readonly label: string; readonly onClick: () => void }
  readonly className?: string
}

export function Empty({ title, description, action, className }: EmptyProps) {
  return (
    <div className={['ui-state', 'ui-state--empty', className].filter(Boolean).join(' ')}>
      <p className="ui-state__title">{title}</p>
      {description ? <p className="ui-state__body">{description}</p> : null}
      {action ? (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
