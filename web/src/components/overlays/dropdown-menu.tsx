/**
 * Le menu d'actions d'une ligne ou d'un en-tête.
 *
 * Base UI porte le clavier (`ArrowDown` ouvre, les flèches parcourent, `Escape` ferme, la saisie
 * saute au premier élément) et le retour du focus au déclencheur. Un menu maison en `<div>` perd les
 * quatre, et le défaut ne se voit qu'au clavier.
 *
 * Une entrée **destructive** se déclare comme telle : elle n'agit pas différemment, elle se lit
 * différemment — et sur une liste de six actions, c'est ce qui empêche « Déconnecter » d'être
 * cliqué pour « Détails ».
 */

import { Menu } from '@base-ui/react/menu'
import type { ReactNode } from 'react'

export type MenuAction = {
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean
  /** Rendu en rouge et séparé du reste. Ne change pas le comportement, change la lecture. */
  readonly destructive?: boolean
}

export type DropdownMenuProps = {
  /** Le déclencheur. Un bouton, jamais un `<div>` : il doit être atteignable au clavier. */
  readonly trigger: ReactNode
  readonly actions: readonly MenuAction[]
  readonly className?: string
}

export function DropdownMenu({ trigger, actions, className }: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger className={['ui-menu__trigger', className].filter(Boolean).join(' ')}>
        {trigger}
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner className="ui-menu__positioner" sideOffset={4}>
          <Menu.Popup className="ui-menu__popup">
            {actions.map((action) => (
              <Menu.Item
                className={['ui-menu__item', action.destructive ? 'ui-menu__item--destructive' : '']
                  .filter(Boolean)
                  .join(' ')}
                key={action.label}
                disabled={action.disabled}
                onClick={action.onSelect}
              >
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
