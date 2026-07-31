/**
 * Le champ de saisie, libellé et message compris.
 *
 * ## Pourquoi un seul composant plutôt que `Field` + `Input` séparés
 *
 * Parce que la partie qui se perd quand on assemble à la main est justement celle qui compte : le
 * lien `aria-describedby` entre le contrôle et son message. Un écran qui compose lui-même finit tôt
 * ou tard par écrire une bordure rouge sans message lié — visible pour qui voit l'écran, invisible
 * pour tous les autres. Le composant rend donc l'ensemble, et l'appelant n'a pas l'occasion de
 * l'oublier.
 *
 * `Field` de Base UI génère les identifiants et pose les liens. On ne les écrit pas à la main : un
 * `id` recopié se désynchronise au premier renommage, et rien ne le signale.
 *
 * ## Erreur ou aide, jamais les deux
 *
 * Empiler le mode d'emploi sous la conséquence noierait la seconde au moment précis où elle compte.
 * Quand une erreur est présente, elle prend la place.
 */

import { Field } from '@base-ui/react/field'
import type { ComponentPropsWithRef, ReactNode } from 'react'

/**
 * `size` est retiré des props natives : l'attribut HTML `size` d'un `<input>` est un **nombre** de
 * caractères visibles, hérité des formulaires de 1995, et il entrerait en collision avec la hauteur
 * de contrôle de la charte. Le laisser passer faisait s'intersecter `number` et `'sm' | 'md'` en
 * `never` — une erreur de compilation illisible, attrapée par `pnpm typecheck`.
 */
/**
 * `ComponentPropsWithRef` et non `…WithoutRef` : un champ qu'aucun écran ne peut focaliser par le
 * code n'est pas complet. Le premier besoin est venu du second facteur (step-026), où la bascule
 * automatique vers l'onglet TOTP démontait le bouton qui portait le focus — celui-ci retombait sur
 * `body`, et le champ ouvert n'était atteignable qu'en re-tabulant tout l'écran.
 */
export type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'className' | 'size'> & {
  /**
   * Appliqué à l'**enveloppe**, pas au contrôle : c'est l'ensemble libellé + champ + message qu'un
   * écran place dans une grille. Le retirer sans le redéclarer, comme c'était le cas, faisait de ce
   * champ la seule primitive du lot qu'aucun écran ne pouvait ni positionner ni élargir.
   */
  readonly className?: string
  readonly label: ReactNode
  /** Message d'aide. Effacé par `error` quand celui-ci est présent — voir l'en-tête. */
  readonly hint?: ReactNode
  /** Message de refus. Sa présence rend le champ `aria-invalid` et le lie au contrôle. */
  readonly error?: ReactNode
  /**
   * Valeur machine : identifiant, compteur, MSISDN, sender ID. La charte réserve le mono à
   * celles-ci — « jamais pour du texte narratif ».
   */
  readonly mono?: boolean
  readonly size?: 'sm' | 'md'
}

export function TextField({
  label,
  hint,
  error,
  mono = false,
  size = 'md',
  required,
  className,
  ...rest
}: TextFieldProps) {
  const invalid = error !== undefined && error !== null && error !== false

  const classes = ['ui-input', mono ? 'ui-input--mono' : '', size === 'sm' ? 'ui-input--sm' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <Field.Root className={['ui-field', className].filter(Boolean).join(' ')} invalid={invalid}>
      <Field.Label className="ui-field__label">
        {label}
        {required ? (
          // L'astérisque est décoratif : `required` sur le contrôle porte l'information pour les
          // technologies d'assistance, et un glyphe seul ne dit rien à qui ne le voit pas.
          <span className="ui-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </Field.Label>

      <Field.Control className={classes} required={required} {...rest} />

      {invalid ? (
        // `match` vaut `true` et non une clé de `ValidityState` : nos refus viennent du serveur —
        // « ce sender ID est déjà pris », « cette adresse n'est pas reconnue » — et aucune règle de
        // validation HTML ne les connaît. La doc prévoit ce cas : `true` laisse l'appelant décider.
        <Field.Error className="ui-field__error" match>
          {error}
        </Field.Error>
      ) : hint ? (
        <Field.Description className="ui-field__hint">{hint}</Field.Description>
      ) : null}
    </Field.Root>
  )
}
