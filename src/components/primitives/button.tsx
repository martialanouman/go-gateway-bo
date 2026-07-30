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

/**
 * `className` est retiré des props de Base UI : la bibliothèque le type `string | ((state) => string)`,
 * et ce composant le concatène. Une fonction passée par un appelant serait alors interpolée
 * littéralement dans l'attribut — `class="ui-button (s) => s.disabled ? …"`. Invisible au typecheck,
 * invisible en revue, découvert à l'écran.
 */
export type ButtonProps = Omit<
  ComponentPropsWithoutRef<typeof BaseButton>,
  'render' | 'className'
> & {
  readonly className?: string
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
      // `aria-disabled` et non `disabled` : le bouton **reste** dans le parcours clavier — un
      // `disabled` nu déplace le focus sans prévenir — mais s'annonce indisponible. `aria-busy` seul
      // ne suffisait pas : aucun des trois lecteurs d'écran majeurs ne l'annonce sur un bouton.
      // Les deux attributs sont posés **après** le spread, plus bas.
      // **`preventDefault`, et non un `onClick` neutralisé.** Neutraliser le handler ne couvre que le
      // chemin React : `<Button type="submit" loading>` soumettait quand même le formulaire, par le
      // clic comme par `Entrée`. Sur un écran de rotation de secret, cela valait une seconde
      // rotation et une seconde ligne d'audit.
      onClick={loading ? (event) => event.preventDefault() : onClick}
      {...rest}
      // **Après le spread**, délibérément : un appelant qui passerait `aria-disabled={false}` ou son
      // propre `aria-busy` désarmerait sinon l'annonce sans avertissement — la même famille de
      // défaut que celle corrigée juste au-dessus.
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : null}
      {children}
    </BaseButton>
  )
}
