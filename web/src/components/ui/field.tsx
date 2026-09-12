import { Field as BaseField } from '@base-ui/react/field'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Icon } from './icon'

/**
 * Le champ : l'enveloppe qui énonce, et le contrôle qui saisit.
 *
 * ## Pourquoi deux composants, et pourquoi le lien tient quand même
 *
 * La charte les nomme séparément, et c'est utile : une barre de filtre veut un `Input` sans libellé
 * au-dessus. Le risque du découpage est connu — un écran finit par composer une bordure rouge sans
 * message lié, visible pour qui voit l'écran, invisible pour tous les autres.
 *
 * Il est fermé sans rien demander à l'appelant : `Field.Root` engendre les identifiants et
 * `Field.Control` s'y relie par le contexte. `aria-describedby` et `aria-invalid` sont posés par la
 * bibliothèque dès que l'`Input` est dans le `Field`. Personne n'écrit d'`id`, donc personne ne peut
 * le désynchroniser au premier renommage.
 *
 * ## Refus ou aide, jamais les deux
 *
 * Empiler le mode d'emploi sous la conséquence noierait la seconde au moment précis où elle compte.
 *
 * ## L'astérisque n'est pas une prop
 *
 * `required` se pose sur l'`Input`, seul endroit où il a un sens pour le navigateur et pour les
 * technologies d'assistance. La marque visuelle en **découle**, par `:has()` dans la feuille, plutôt
 * que d'être déclarée une seconde fois sur le `Field` : deux déclarations se contredisent tôt ou
 * tard, et c'est l'ornement qui gagnerait à l'écran pendant que la sémantique dirait l'inverse.
 * Conséquence assumée : jsdom n'applique pas le CSS, donc cette marque-là se vérifie sur le
 * parcours de bout en bout, pas ici.
 */

export type FieldProps = {
  readonly label?: ReactNode
  /** Conséquence du réglage, en langage clair. Effacé par `error` quand celui-ci est présent. */
  readonly hint?: ReactNode
  /** Message de refus. Sa présence rend le contrôle `aria-invalid` et le lui relie. */
  readonly error?: ReactNode
  /** Emplacement à côté du libellé, pour une pilule de portée ou de permission. */
  readonly badge?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

export function Field({ label, hint, error, badge, children, className }: FieldProps) {
  const invalid = error !== undefined && error !== null && error !== false

  return (
    <BaseField.Root className={['ui-field', className].filter(Boolean).join(' ')} invalid={invalid}>
      {label === undefined ? null : (
        <BaseField.Label className="ui-field__label">
          {label}
          {badge}
        </BaseField.Label>
      )}

      {children}

      {invalid ? (
        // `match` vaut `true` et non une clé de `ValidityState` : nos refus viennent du serveur —
        // « ce sender ID est déjà pris », « cette adresse n'est pas reconnue » — et aucune règle de
        // validation HTML ne les connaît.
        <BaseField.Error className="ui-field__error" match>
          <Icon name="bang" size={12} />
          {error}
        </BaseField.Error>
      ) : hint === undefined ? null : (
        <BaseField.Description className="ui-field__hint">{hint}</BaseField.Description>
      )}
    </BaseField.Root>
  )
}

/**
 * `size` est retiré des props natives : l'attribut HTML `size` d'un `<input>` est un **nombre** de
 * caractères visibles, hérité des formulaires de 1995, et il entrerait en collision avec la hauteur
 * de contrôle de la charte. Le laisser passer faisait s'intersecter `number` et `'sm' | 'md'` en
 * `never`, une erreur de compilation illisible.
 *
 * `ComponentPropsWithRef` et non `…WithoutRef` : un champ qu'aucun écran ne peut focaliser par le
 * code n'est pas complet — une bascule d'onglet qui démonte le porteur du focus le laisse retomber
 * sur `body`, et le champ ouvert n'est plus atteignable qu'en re-tabulant tout l'écran.
 */
export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'className' | 'size'> & {
  readonly className?: string
  /** Glyphe de tête — `search` dans une barre de filtre. Décoratif : le libellé porte le sens. */
  readonly icon?: string
  /**
   * Valeur machine : identifiant, compteur, MSISDN, sender ID. La charte réserve le mono à
   * celles-ci — « jamais pour du texte narratif ».
   */
  readonly mono?: boolean
  readonly size?: 'sm' | 'md'
}

export function Input({ icon, mono = false, size = 'md', className, ...rest }: InputProps) {
  const classes = [
    'ui-input',
    mono ? 'ui-input--mono' : '',
    size === 'sm' ? 'ui-input--sm' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const control = <BaseField.Control className={classes} {...rest} />

  // Sans icône, aucune enveloppe : un élément de plus dans le DOM pour rien déplacerait la grille
  // que l'écran compose autour du champ.
  if (icon === undefined) return control

  return (
    <span className="ui-input-wrap">
      <span className="ui-input-wrap__icon">
        <Icon name={icon} size={13} />
      </span>
      {control}
    </span>
  )
}
