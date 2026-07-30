/**
 * Le groupe de boutons radio.
 *
 * Son contrat clavier est le moins évident du lot, et le plus souvent cassé : **une seule entrée
 * dans l'ordre de tabulation** pour tout le groupe, puis les flèches parcourent les choix. Une
 * réimplémentation en `<input type="radio">` posés côte à côte donne le bon rendu et le mauvais
 * parcours — chaque choix devient un arrêt de tabulation, et un formulaire à six options en compte
 * six au lieu d'un.
 *
 * Le groupe porte aussi son propre nom accessible. Sans lui, un lecteur d'écran annonce « Pool
 * partagé, bouton radio » sans jamais dire de quoi il s'agit.
 */

import { Radio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useId } from 'react'

export type RadioOption = {
  readonly value: string
  readonly label: ReactNode
  readonly disabled?: boolean
}

export type RadioGroupProps = Omit<
  ComponentPropsWithoutRef<typeof BaseRadioGroup>,
  'render' | 'children'
> & {
  readonly label: ReactNode
  readonly options: readonly RadioOption[]
}

export function RadioGroup({ label, options, className, ...rest }: RadioGroupProps) {
  const labelId = useId()

  return (
    <div className={['ui-radiogroup', className].filter(Boolean).join(' ')}>
      <span className="ui-radiogroup__label" id={labelId}>
        {label}
      </span>

      <BaseRadioGroup className="ui-radiogroup__options" aria-labelledby={labelId} {...rest}>
        {options.map((option) => (
          // `htmlFor` explicite, même raison que dans `checkbox.tsx` : Base UI rend un bouton et un
          // input masqué, que l'analyse statique ne relie pas au libellé qui les entoure.
          <label className="ui-radio" key={option.value} htmlFor={`${labelId}-${option.value}`}>
            <Radio.Root
              className="ui-radio__control"
              id={`${labelId}-${option.value}`}
              value={option.value}
              disabled={option.disabled}
            >
              <Radio.Indicator className="ui-radio__indicator" />
            </Radio.Root>
            <span className="ui-radio__label">{option.label}</span>
          </label>
        ))}
      </BaseRadioGroup>
    </div>
  )
}
