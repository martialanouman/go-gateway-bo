import { Field as BaseField } from '@base-ui/react/field'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { type GlyphName, Icon } from './icon'

/**
 * Le champ : l'enveloppe qui énonce, et le contrôle qui saisit.
 *
 * **Deux composants, et le lien tient quand même.** Le découpage sert une barre de filtre, qui veut
 * un `Input` sans libellé ; son risque est une bordure rouge sans message lié, visible pour qui voit
 * l'écran et invisible pour tous les autres. Il est fermé par le contexte de Base UI : `Field.Root`
 * engendre les identifiants, `Field.Control` s'y relie, et personne n'écrit d'`id` qu'un renommage
 * pourrait désynchroniser. **Ce que la garantie ne couvre pas** : un `<input>` nu ou un contrôle
 * maison placé dans un `Field` reçoit la bordure et le message, mais **aucun lien** — `children` est
 * un `ReactNode`, et ni le type ni l'exécution ne l'empêchent.
 *
 * **Refus ou aide, jamais les deux** : empiler le mode d'emploi sous la conséquence noierait la
 * seconde au moment précis où elle compte.
 *
 * **L'astérisque n'est pas une prop.** `required` se pose sur l'`Input`, seul endroit où il a un sens
 * pour le navigateur et pour les technologies d'assistance ; la marque visuelle en **découle**, par
 * `:has()` dans la feuille. Deux déclarations se contredisent tôt ou tard, et c'est l'ornement qui
 * gagnerait à l'écran pendant que la sémantique dirait l'inverse. Conséquence assumée : jsdom
 * n'applique pas le CSS, donc cette marque se vérifie sur le parcours de bout en bout, pas ici.
 */

export type FieldProps = {
  readonly label?: ReactNode
  /** Conséquence du réglage, en langage clair. Effacé par `error` quand celui-ci est présent. */
  readonly hint?: ReactNode
  /** Message de refus. Sa présence rend le contrôle `aria-invalid` et le lui relie. */
  readonly error?: ReactNode
  /** Emplacement à côté du libellé, pour une pilule de portée ou de permission. */
  readonly children?: ReactNode
  readonly className?: string
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  // `Boolean` et non trois comparaisons : `error={apiError ?? ''}` — le geste naturel quand le
  // serveur rend une chaîne vide, et `0` de même — passe les trois et fabrique un champ **invalide
  // muet** : bordure rouge, `aria-invalid`, un message vide dans `aria-describedby`, et l'aide
  // effacée. Un élément React reste truthy, donc rien d'utile n'est perdu.
  const invalid = Boolean(error)

  return (
    <BaseField.Root className={['ui-field', className].filter(Boolean).join(' ')} invalid={invalid}>
      {label === undefined ? null : (
        <BaseField.Label className="ui-field__label">{label}</BaseField.Label>
      )}

      {children}

      {invalid ? (
        // `match` vaut `true` et non une clé de `ValidityState` : nos refus viennent du serveur —
        // « ce sender ID est déjà pris », « cette adresse n'est pas reconnue » — et aucune règle de
        // validation HTML ne les connaît.
        // `role="alert"` : Base UI ne pose ni rôle ni région live sur `Field.Error` — vérifié dans
        // `FieldError.js`, qui ne rend que `{ id, children }`. Or nos refus arrivent **après** une
        // réponse du serveur, sans que le focus ait bougé : le message apparaît alors dans un
        // élément inerte que les lecteurs d'écran ne relisent pas. WCAG 2.1 AA, 4.1.3.
        <BaseField.Error className="ui-field__error" match role="alert">
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
  /**
   * Glyphe de tête — `search` dans une barre de filtre. Décoratif : le libellé porte le sens.
   *
   * Typé sur le jeu, et non `string` : `icon.tsx` promet qu'« un nom absent se voit au typecheck,
   * bien avant de ne rien rendre à l'écran », qu'un `string` ici ferait passer à côté. Aucun appelant
   * de production ne pose encore cette prop.
   */
  readonly icon?: GlyphName
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
