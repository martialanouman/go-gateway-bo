/**
 * La case à cocher.
 *
 * L'indicateur visuel est un `<span>`, mais le contrôle réel est celui de Base UI : rôle, état
 * `mixed`, gestion du clavier et association au libellé viennent de la bibliothèque. Une case
 * dessinée en `<div onClick>` a exactement la même apparence et n'existe pas pour un lecteur
 * d'écran — c'est le mode d'échec que ce fichier existe pour éviter.
 */

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type CheckboxProps = Omit<ComponentPropsWithoutRef<typeof BaseCheckbox.Root>, 'render'> & {
  readonly label?: ReactNode
  /** Précision sous le libellé, pour une conséquence qui ne tient pas en trois mots. */
  readonly description?: ReactNode
}

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  const control = (
    <BaseCheckbox.Root className="ui-check__control" {...rest}>
      <BaseCheckbox.Indicator className="ui-check__indicator" />
    </BaseCheckbox.Root>
  )

  if (!label && !description) return control

  return (
    <label className={['ui-check', className].filter(Boolean).join(' ')}>
      {control}
      <span className="ui-check__text">
        {label}
        {description ? <span className="ui-check__description">{description}</span> : null}
      </span>
    </label>
  )
}
