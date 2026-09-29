import { Popover as BasePopover } from '@base-ui/react/popover'
import { Tooltip } from '@base-ui/react/tooltip'
import { type ReactNode, useRef } from 'react'
import { Icon } from './icon'

export type PopoverProps = {
  /**
   * Le nom accessible du déclencheur, repris dans son infobulle : un chiffre seul dans un bouton ne
   * dit pas ce qu'il compte.
   */
  readonly label: string
  readonly trigger: ReactNode
  readonly title: string
  /** Ce que le panneau ne promet pas : lu à l'ouverture, et montré en infobulle à côté du titre. */
  readonly hint: string
  readonly children: ReactNode
}

export function Popover({ label, trigger, title, hint, children }: PopoverProps) {
  const popup = useRef<HTMLDivElement>(null)

  return (
    <BasePopover.Root>
      {/* Un déclencheur réduit à une icône porte son nom en infobulle, au survol comme au focus. */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <BasePopover.Trigger
              aria-label={label}
              className="ui-button ui-button--secondary ui-button--sm"
            />
          }
        >
          {trigger}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={6}>
            <Tooltip.Popup className="ui-tooltip">{label}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <BasePopover.Portal>
        <BasePopover.Positioner align="end" className="ui-popover__positioner" sideOffset={4}>
          {/* Le premier focusable serait l'infobulle, qui s'ouvrirait d'elle-même et prendrait le premier
              Échap : le panneau prend le focus, et Tab mène au contenu. */}
          <BasePopover.Popup className="ui-popover__popup" initialFocus={popup} ref={popup}>
            <div className="ui-popover__header">
              <BasePopover.Title className="ui-popover__title">{title}</BasePopover.Title>
              <BasePopover.Description className="ui-visually-hidden">
                {hint}
              </BasePopover.Description>
              <Tooltip.Root>
                <Tooltip.Trigger aria-label="Précisions" className="ui-popover__hint">
                  <Icon name="info" size={14} />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner className="ui-popover__tooltip" sideOffset={6}>
                    <Tooltip.Popup className="ui-tooltip">{hint}</Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
