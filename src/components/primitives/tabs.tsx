/**
 * Les onglets.
 *
 * `role="tablist"` est une **promesse de comportement** : les flèches déplacent la sélection, la
 * tabulation saute au panneau plutôt que de parcourir chaque onglet. L'annoncer sans le tenir est
 * pire que de ne rien annoncer, puisque l'utilisateur au clavier fait confiance à l'annonce. Base UI
 * tient la promesse ; ce fichier ne fait que l'habiller.
 *
 * Le compteur est rendu **dans** l'onglet et non à côté : il fait partie du nom accessible, si bien
 * qu'un lecteur d'écran annonce « Binds 12 » plutôt que « Binds » suivi d'un nombre orphelin.
 */

import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type TabDefinition = {
  readonly value: string
  readonly label: ReactNode
  /** Affiché quand il est connu. `0` reste affiché — c'est une information, pas une absence. */
  readonly count?: number
  readonly disabled?: boolean
  /**
   * Le contenu de l'onglet.
   *
   * **Sans panneau, `role="tablist"` est une promesse intenable** : les onglets n'annoncent aucun
   * `aria-controls`, et la tabulation — qui doit sauter au panneau — atterrit sur le premier élément
   * focusable venu. Le rôle serait annoncé sans être tenu, ce qui est pire que de ne rien annoncer.
   *
   * Optionnel malgré tout : des onglets qui pilotent la **route** n'ont pas de panneau local, et
   * c'est un usage légitime. Le composant rend alors la liste seule — voir le test.
   */
  readonly panel?: ReactNode
}

export type TabsProps = Omit<
  ComponentPropsWithoutRef<typeof BaseTabs.Root>,
  'render' | 'children'
> & {
  readonly tabs: readonly TabDefinition[]
}

export function Tabs({ tabs, className, ...rest }: TabsProps) {
  return (
    <BaseTabs.Root className={['ui-tabs', className].filter(Boolean).join(' ')} {...rest}>
      <BaseTabs.List className="ui-tabs__list">
        {tabs.map((tab) => (
          <BaseTabs.Tab
            className="ui-tab"
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
          >
            {tab.label}
            {tab.count !== undefined ? <span className="ui-tab__count">{tab.count}</span> : null}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="ui-tabs__indicator" />
      </BaseTabs.List>

      {tabs.map((tab) =>
        tab.panel === undefined ? null : (
          <BaseTabs.Panel className="ui-tabs__panel" key={tab.value} value={tab.value}>
            {tab.panel}
          </BaseTabs.Panel>
        ),
      )}
    </BaseTabs.Root>
  )
}
