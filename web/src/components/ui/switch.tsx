import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { Tooltip } from '@base-ui/react/tooltip'
import { useId } from 'react'

export type SwitchProps = {
  readonly label: string
  readonly description?: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  /** Interdit, et la phrase qui dit pourquoi : le switch reste atteignable au clavier (voir `Button`). */
  readonly blockedReason?: string
  /** Dans une cellule de tableau : le libellé ne s'adresse qu'aux lecteurs d'écran. */
  readonly compact?: boolean
}

/**
 * Un réglage binaire qui s'applique **aussitôt** (charte, `forms/Switch`) ; ce qui attend un
 * « Enregistrer » prend une case à cocher.
 */
export function Switch({
  label,
  description,
  checked,
  onCheckedChange,
  blockedReason,
  compact = false,
}: SwitchProps) {
  const labelId = useId()
  const descriptionId = useId()
  const reasonId = useId()
  const describedBy =
    [description ? descriptionId : '', blockedReason ? reasonId : ''].filter(Boolean).join(' ') ||
    undefined

  const control = (
    <BaseSwitch.Root
      aria-describedby={describedBy}
      aria-disabled={blockedReason ? true : undefined}
      aria-labelledby={labelId}
      checked={checked}
      className="ui-switch"
      onCheckedChange={(next) => onCheckedChange(next)}
      readOnly={blockedReason !== undefined}
    >
      <BaseSwitch.Thumb className="ui-switch__thumb" />
    </BaseSwitch.Root>
  )

  return (
    <div
      className={['ui-switch-row', compact ? 'ui-switch-row--compact' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="ui-switch-row__text">
        <span className={compact ? 'ui-visually-hidden' : 'ui-switch-row__label'} id={labelId}>
          {label}
        </span>
        {description ? (
          <span className="ui-switch-row__hint" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </div>
      {blockedReason === undefined ? (
        control
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger render={control} />
          <span className="ui-visually-hidden" id={reasonId}>
            {blockedReason}
          </span>
          <Tooltip.Portal>
            <Tooltip.Positioner sideOffset={6}>
              <Tooltip.Popup className="ui-tooltip">{blockedReason}</Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </div>
  )
}
