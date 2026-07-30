/**
 * L'interrupteur.
 *
 * Distinct de la case à cocher **par le rôle**, et ce n'est pas un détail de forme : un interrupteur
 * applique son effet immédiatement, une case attend une validation. Un lecteur d'écran annonce
 * « interrupteur, activé » dans un cas et « case à cocher, cochée » dans l'autre, et l'opérateur en
 * déduit s'il doit encore valider. Les intervertir se voit rarement à l'œil et s'entend toujours.
 */

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type SwitchProps = Omit<ComponentPropsWithoutRef<typeof BaseSwitch.Root>, 'render'> & {
  readonly label?: ReactNode
}

export function Switch({ label, className, ...rest }: SwitchProps) {
  const control = (
    <BaseSwitch.Root className="ui-switch__track" {...rest}>
      <BaseSwitch.Thumb className="ui-switch__thumb" />
    </BaseSwitch.Root>
  )

  if (!label) return control

  return (
    <label className={['ui-switch', className].filter(Boolean).join(' ')}>
      {control}
      <span className="ui-switch__label">{label}</span>
    </label>
  )
}
