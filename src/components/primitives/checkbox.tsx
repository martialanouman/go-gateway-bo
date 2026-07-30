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
import { useId } from 'react'

export type CheckboxProps = Omit<ComponentPropsWithoutRef<typeof BaseCheckbox.Root>, 'render'> & {
  readonly label?: ReactNode
  /** Précision sous le libellé, pour une conséquence qui ne tient pas en trois mots. */
  readonly description?: ReactNode
}

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const generatedId = useId()
  // `htmlFor` plutôt qu'un `<label>` qui enveloppe : Base UI rend un `<button role="checkbox">`
  // accompagné d'un input masqué, et l'analyse statique de Biome ne voit pas cette association à
  // travers la bibliothèque. L'identifiant explicite la rend visible **et** garde le libellé
  // cliquable — un `aria-labelledby` aurait satisfait le linter en perdant la cible de clic.
  const controlId = id ?? generatedId

  const control = (
    <BaseCheckbox.Root className="ui-check__control" id={controlId} {...rest}>
      <BaseCheckbox.Indicator className="ui-check__indicator" />
    </BaseCheckbox.Root>
  )

  if (!label && !description) return control

  return (
    <label className={['ui-check', className].filter(Boolean).join(' ')} htmlFor={controlId}>
      {control}
      <span className="ui-check__text">
        {label}
        {description ? <span className="ui-check__description">{description}</span> : null}
      </span>
    </label>
  )
}
