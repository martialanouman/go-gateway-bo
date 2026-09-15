import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/**
 * Le bouton du produit.
 *
 * ## Contour et teinte, jamais un aplat
 *
 * La charte l'écrit pour le cas destructif — « toujours en contour, jamais plein » — et ses
 * spécimens montrent la même chose pour le primaire. Ce n'est pas une préférence : sur des surfaces
 * quasi-noires, un aplat teal capte le regard plus fort qu'une alerte rouge, et l'accent unique du
 * système perdrait son sens.
 *
 * ## Base UI pour le comportement
 *
 * `Button` de Base UI porte la sémantique et laisse la forme libre. On ne réimplémente ni le focus
 * ni le clavier — deux endroits où une réécriture maison casse l'accessibilité en silence.
 */

/**
 * Quatre variantes. Le kit de la charte en dessine deux de plus, `ghost` et `dangerGhost`, pour les
 * actions de ligne d'un tableau : elles arriveront avec le premier écran qui en a, plutôt qu'en
 * bibliothèque devinée d'avance.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link'

/** 28 / 34 / 40 px — les trois hauteurs de contrôle de la charte, et rien entre les deux. */
export type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * `className` est retiré des props de Base UI : la bibliothèque le type
 * `string | ((state) => string)`, et ce composant le concatène. Une fonction passée par un appelant
 * serait interpolée littéralement dans l'attribut — `class="ui-button (s) => s.disabled ? …"`.
 * Invisible au typecheck, invisible en revue, découvert à l'écran.
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
   * que de disparaître : un `disabled` nu déplace le focus sans prévenir, et un lecteur d'écran
   * perd le fil au moment précis où l'opérateur attend une nouvelle.
   */
  readonly loading?: boolean
  /**
   * Action **interdite pour l'instant**, dont l'existence doit rester visible.
   *
   * Même mécanique que `loading` : `aria-disabled` plutôt que `disabled`. « Un contrôle interdit est
   * désactivé **et expliqué**, jamais silencieusement masqué » — or un `disabled` nu le retire de
   * l'arbre d'accessibilité, et l'opérateur au lecteur d'écran ne sait ni qu'il existe ni ce qui le
   * débloquerait.
   *
   * L'appelant reste tenu de dire **pourquoi**, par `aria-describedby`. Le rendu conditionnel n'est
   * qu'un confort : la garde est côté serveur, invariant (c).
   */
  readonly blocked?: boolean
  readonly children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  blocked = false,
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  // Ni `--loading` ni `--blocked` : les deux états sont peints par `.ui-button[aria-disabled]`,
  // l'attribut que ce composant pose déjà et que la feuille cible. Les émettre en plus aurait mis
  // deux classes mortes sur chaque bouton — « une entrée morte élargit la surface sans que personne
  // ne s'en aperçoive », et le défaut vaut dans les deux sens.
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    size === 'md' ? '' : `ui-button--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <BaseButton
      // Sans `type="button"` par défaut, un bouton dans un formulaire le soumet, et un « Annuler »
      // enverrait la requête qu'il prétend abandonner.
      type={type}
      className={classes}
      disabled={disabled}
      // **`preventDefault`, et non un `onClick` neutralisé.** Neutraliser le gestionnaire ne couvre
      // que le chemin React : `<Button type="submit" loading>` soumettait quand même le formulaire,
      // par le clic comme par Entrée.
      onClick={loading || blocked ? (event) => event.preventDefault() : onClick}
      {...rest}
      // **Après le spread**, délibérément : un appelant qui passerait `aria-disabled={false}` ou son
      // propre `aria-busy` désarmerait sinon l'annonce sans avertissement.
      aria-busy={loading || undefined}
      aria-disabled={loading || blocked || undefined}
    >
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : null}
      {children}
    </BaseButton>
  )
}
