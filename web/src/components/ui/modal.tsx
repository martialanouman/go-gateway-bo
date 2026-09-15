import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import { Icon } from './icon'

/**
 * La modale du produit : confirmations conséquentes et secrets montrés une seule fois.
 *
 * ## Base UI porte ce qu'une réécriture maison casse en silence
 *
 * Piège du focus, restauration du focus à la fermeture, verrou du défilement, inertie de ce qu'il y
 * a derrière, fermeture par `Échap` et par le voile. Le `Modal.jsx` du kit de la charte n'a **aucun
 * des quatre premiers** — il n'est pas du code de production, il montre une apparence. Ce fichier
 * reprend son apparence et laisse le comportement à `@base-ui/react/dialog`.
 *
 * ## Le contenu est démonté, pas masqué
 *
 * `Dialog.Portal` est monté **sans `keepMounted`** : à la fermeture, le contenu quitte le DOM. Ce
 * n'est pas une optimisation, c'est l'invariant (b) — M3 exigera qu'« après fermeture de la modale
 * le secret soit introuvable dans le DOM, l'état, le cache Query et les logs ». Un `keepMounted` le
 * laisserait dans le document, masqué, et le test qui cherche la chaîne la trouverait.
 *
 * ## Le voile ne floute pas
 *
 * `--scrim-blur` existe dans les tokens et reste délibérément non consommé : « blurring live metrics
 * behind a dialog costs more than it gives ». Un cockpit dont les compteurs continuent de défiler
 * derrière une confirmation vaut mieux qu'un effet de profondeur.
 */

export type ModalProps = {
  readonly open: boolean
  /**
   * Fermer, quelle que soit la façon dont l'opérateur l'a demandé — `Échap`, le voile, la croix.
   * Aucun filtre sur la raison : une modale qui ne se ferme que par son bouton est un piège dont on
   * ne sort qu'à la souris.
   */
  readonly onClose: () => void
  /**
   * Le titre, qui donne son **nom accessible** à la modale : Base UI relie `aria-labelledby` à
   * `Dialog.Title` tout seul. Rendu en `h2`, ce qui compte pour toute page dont un test compte les
   * titres de section.
   */
  readonly title: ReactNode
  /** Un `StatusPill` ou un `Icon` en tête d'en-tête, quand le titre seul ne situe pas l'objet. */
  readonly icon?: ReactNode
  /** 820 px au lieu de 520 : création d'identifiant, résultats de simulation. */
  readonly wide?: boolean
  /** Les actions, alignées à droite. La destructive à droite de tout. */
  readonly footer?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  wide = false,
  footer,
  children,
  className,
}: ModalProps) {
  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-scrim" />
        <Dialog.Popup
          className={['ui-modal', wide ? 'ui-modal--wide' : '', className]
            .filter(Boolean)
            .join(' ')}
        >
          <header className="ui-modal__head">
            {icon}
            <Dialog.Title className="ui-modal__title">{title}</Dialog.Title>
            {/*
              `Dialog.Close` **à l'intérieur du popup**, ce que Base UI exige en mode modal : « render
              `<Dialog.Close>` inside `<Dialog.Popup>` so touch screen readers can escape the popup ».
              Le glyphe est `times` — le jeu de la charte n'a pas de `x`, et un nom hors du jeu ne
              rend rien.
            */}
            <Dialog.Close aria-label="Fermer" className="ui-modal__close">
              <Icon name="times" size={14} />
            </Dialog.Close>
          </header>

          <div className="ui-modal__body">{children}</div>

          {footer === undefined ? null : <div className="ui-modal__foot">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
