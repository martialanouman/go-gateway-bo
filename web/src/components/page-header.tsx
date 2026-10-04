import { Link, type LinkProps } from '@tanstack/react-router'
import { createContext, type ReactNode, type Ref, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

export type Crumb = { readonly label: ReactNode; readonly link: LinkProps }

type Slot = {
  readonly node: HTMLElement | null
  readonly attach: (node: HTMLElement | null) => void
}

const SlotContext = createContext<Slot | undefined>(undefined)

/**
 * L'en-tête d'un écran vit dans la barre supérieure de la coquille, mais l'écran le déclare : son titre
 * est souvent une donnée (le nom d'un compte), et ses actions ferment sur son état. Un portail garde
 * l'arbre React de l'écran — requêtes, permissions, `ref` du titre — tout en peignant ailleurs.
 */
export function PageHeaderProvider({ children }: { readonly children: ReactNode }) {
  const [node, attach] = useState<HTMLElement | null>(null)
  return <SlotContext.Provider value={{ node, attach }}>{children}</SlotContext.Provider>
}

export function PageHeaderSlot() {
  return <div className="topbar__start" ref={useContext(SlotContext)?.attach} />
}

export function PageHeader({
  title,
  titleRef,
  crumbs,
  badges,
  actions,
}: {
  readonly title: ReactNode
  readonly titleRef?: Ref<HTMLHeadingElement>
  readonly crumbs?: readonly Crumb[]
  readonly badges?: ReactNode
  readonly actions?: ReactNode
}) {
  const node = useContext(SlotContext)?.node
  if (node == null) return null

  return createPortal(
    <>
      {crumbs === undefined ? null : (
        <nav aria-label="Fil d’Ariane" className="page-header__crumbs">
          <ol>
            {crumbs.map((crumb, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: le fil est rendu en entier à chaque fois, jamais réordonné.
              <li key={index}>
                <Link {...crumb.link}>{crumb.label}</Link>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="page-header__identity">
        <h1 className="page-header__title" ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        {badges}
      </div>
      {actions === undefined ? null : <div className="page-header__actions">{actions}</div>}
    </>,
    node,
  )
}
