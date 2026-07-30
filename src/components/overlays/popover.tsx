/**
 * Le popover — le contenu **interactif** qu'une infobulle ne peut pas porter.
 *
 * La distinction n'est pas cosmétique : une infobulle se ferme dès que la souris s'éloigne et ne
 * reçoit jamais le focus, donc rien de cliquable ne peut y vivre. Dès qu'un panneau flottant
 * contient un bouton, un champ ou un lien, c'est un popover — sans quoi son contenu est inatteignable
 * au clavier.
 */

import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactNode } from 'react'

export type PopoverProps = {
  readonly trigger: ReactNode
  readonly title?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

export function Popover({ trigger, title, children, className }: PopoverProps) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger className={['ui-popover__trigger', className].filter(Boolean).join(' ')}>
        {trigger}
      </BasePopover.Trigger>

      <BasePopover.Portal>
        <BasePopover.Positioner className="ui-popover__positioner" sideOffset={6}>
          <BasePopover.Popup className="ui-popover">
            {title ? (
              <BasePopover.Title className="ui-popover__title">{title}</BasePopover.Title>
            ) : null}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
