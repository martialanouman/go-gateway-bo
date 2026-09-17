import type { ReactNode } from 'react'

export function Page({ children }: { readonly children: ReactNode }) {
  return <div className="page">{children}</div>
}

/** La sous-barre d'un écran : filtres à gauche, actions à droite. */
export function Toolbar({
  children,
  end,
}: {
  readonly children?: ReactNode
  readonly end?: ReactNode
}) {
  return (
    <div className="toolbar">
      {children}
      {end === undefined ? null : <div className="toolbar__end">{end}</div>}
    </div>
  )
}
