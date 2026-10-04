import type { ReactNode } from 'react'

/** La sous-barre d'un écran : filtres à gauche, actions à droite. */
export function Toolbar({
  children,
  end,
}: {
  readonly children?: ReactNode
  readonly end?: ReactNode
}) {
  return (
    <div className="ui-toolbar">
      {children}
      {end === undefined ? null : <div className="ui-toolbar__end">{end}</div>}
    </div>
  )
}
