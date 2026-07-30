/**
 * Le bouton du produit.
 *
 * ## Contour et teinte, jamais un aplat
 *
 * La charte l'écrit pour le cas destructif — « toujours en contour, jamais plein » — et ses
 * spécimens montrent la même chose pour le primaire. Ce n'est pas une préférence : sur des surfaces
 * quasi-noires, un aplat teal capte le regard plus fort qu'une alerte rouge, et l'accent unique du
 * système perdrait son sens. Quatre variantes, aucune autre.
 *
 * ## `Base UI` pour le comportement
 *
 * `Button` de Base UI porte la sémantique (`type`, désactivation, événements clavier) et laisse la
 * forme entièrement libre. On ne réimplémente donc ni le focus, ni la gestion du clavier — deux
 * endroits où une réécriture maison casse l'accessibilité sans que rien ne le signale.
 */

import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'link'

/** 28 / 34 / 40 px — les trois hauteurs de contrôle de la charte, et rien entre les deux. */
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'render'> & {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /**
   * Action en cours. Le bouton **reste dans le parcours clavier** et s'annonce `aria-busy` plutôt
   * que de disparaître : un `disabled` nu déplace le focus sans prévenir, et un lecteur d'écran perd
   * le fil au moment précis où l'opérateur attend une nouvelle.
   */
  readonly loading?: boolean
  readonly children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    size !== 'md' ? `ui-button--${size}` : '',
    loading ? 'ui-button--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <BaseButton
      // `type="button"` par défaut : sans lui, un bouton dans un formulaire le soumet, et un
      // « Annuler » enverrait la requête qu'il prétend abandonner.
      type={type}
      className={classes}
      disabled={disabled}
      aria-busy={loading || undefined}
      // Occupé veut dire « ne repartez pas » : le second clic ne relance pas l'action. La garde est
      // ici plutôt que dans `disabled`, pour ne pas retirer le bouton du clavier.
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : null}
      {children}
    </BaseButton>
  )
}
