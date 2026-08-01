/**
 * La modale.
 *
 * Base UI porte les trois propriétés qu'on ne réécrit pas à la main : le **piège de focus**, la
 * **restauration du focus** à la fermeture, et `Escape`. Chacune se réimplémente mal — un piège
 * maison laisse échapper le focus vers la barre d'adresse, une restauration oubliée renvoie
 * l'opérateur en haut de page, et un `Escape` absent enferme qui n'a pas de souris.
 *
 * Le voile est le seul endroit du système avec de la transparence, et il ne floute pas : « flouter
 * des métriques en direct derrière une boîte de dialogue coûte plus que cela n'apporte ».
 */

import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

export type DialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  /** La conséquence, en clair. Une modale qui ne dit pas ce qu'elle fait n'a pas lieu d'être. */
  readonly description?: ReactNode
  readonly children?: ReactNode
  /** Les actions, de la moins engageante à la plus engageante — l'ordre de lecture. */
  readonly footer?: ReactNode
  readonly className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ui-dialog__backdrop" />
        <BaseDialog.Popup className={['ui-dialog', className].filter(Boolean).join(' ')}>
          <BaseDialog.Title className="ui-dialog__title">{title}</BaseDialog.Title>
          {description ? (
            <BaseDialog.Description className="ui-dialog__description">
              {description}
            </BaseDialog.Description>
          ) : null}
          {children ? <div className="ui-dialog__body">{children}</div> : null}
          {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
