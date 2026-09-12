/**
 * Le sélecteur.
 *
 * Base UI plutôt qu'un `<select>` natif, pour une raison précise : la charte impose des surfaces
 * quasi-noires et une liste native est peinte par le système d'exploitation, hors d'atteinte du
 * thème. Sur macOS, une liste blanche s'ouvrirait au milieu d'une console sombre, en pleine veille
 * de nuit — exactement ce que « sombre & reposant » cherche à éviter.
 *
 * Le prix est qu'il faut alors **redonner** ce que le natif offrait : rôle, clavier, saisie au
 * premier caractère, fermeture à `Escape`. C'est ce que la bibliothèque fournit, et c'est la seule
 * raison de ne pas l'écrire soi-même.
 */

import { Select as BaseSelect } from '@base-ui/react/select'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { useId } from 'react'

export type SelectOption = {
  readonly value: string
  readonly label: ReactNode
  readonly disabled?: boolean
}

export type SelectProps = Omit<
  ComponentPropsWithoutRef<typeof BaseSelect.Root>,
  'render' | 'children' | 'items' | 'multiple'
> & {
  /**
   * **Obligatoire**, et c'est le seul champ du lot à l'exiger.
   *
   * Sans lui, le nom accessible du `combobox` se réduit au texte de la valeur : un lecteur d'écran
   * annonce « Pool partagé, zone de liste » sans jamais dire de quoi on choisit la portée. Les
   * quatre autres primitives de saisie portent leur libellé ; celle-ci l'oubliait, et c'était le
   * point le plus fragile de l'abandon du `<select>` natif — celui-là s'associait à un `<label>`
   * gratuitement.
   */
  readonly label: ReactNode
  readonly options: readonly SelectOption[]
  /** Texte affiché tant que rien n'est choisi. Jamais une valeur déguisée en choix. */
  readonly placeholder?: string
  readonly className?: string
  readonly size?: 'sm' | 'md'
}

export function Select({
  label,
  options,
  placeholder = 'Choisir…',
  className,
  size = 'md',
  ...rest
}: SelectProps) {
  const labelId = useId()
  const triggerClasses = ['ui-select', size === 'sm' ? 'ui-select--sm' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    // `items` n'est pas une redite de la liste rendue plus bas : les `Select.Item` vivent dans un
    // portail qui n'est monté qu'à l'ouverture. Sans cette correspondance passée d'avance, le
    // déclencheur fermé afficherait la **valeur brute** (`per_account`) au lieu de son libellé —
    // c'est-à-dire un identifiant technique là où la charte veut une phrase.
    <BaseSelect.Root items={options as SelectOption[]} {...rest}>
      <span className="ui-select__label" id={labelId}>
        {label}
      </span>

      <BaseSelect.Trigger className={triggerClasses} aria-labelledby={labelId}>
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="ui-select__caret" aria-hidden="true" />
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner className="ui-select__positioner" sideOffset={4}>
          <BaseSelect.Popup className="ui-select__popup">
            {options.map((option) => (
              <BaseSelect.Item
                className="ui-select__item"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
