/**
 * **Une dégradation propre, jamais une erreur.**
 *
 * C'est le plus important des cinq états, et celui qu'on rate le plus souvent. La facturation
 * désactivée sur la passerelle (§1.3) n'est pas une panne : rien n'a échoué, rien n'est à réparer,
 * et rendre cet état en rouge ferait ouvrir un ticket pour une fonctionnalité que personne n'a
 * activée.
 *
 * Pas de `role="alert"`, pas de rouge, pas de « Réessayer » — réessayer n'activerait rien. Le module
 * est **nommé**, pour que l'opérateur sache quoi demander et à qui.
 */

import type { ReactNode } from 'react'

export type ModuleDisabledProps = {
  /** Le nom du module, tel que l'opérateur le connaît : « Facturation », « Anti-spam ». */
  readonly module: string
  /** Ce qui reste accessible malgré tout. La dégradation se dit, elle ne se devine pas. */
  readonly stillAvailable?: ReactNode
  readonly className?: string
}

export function ModuleDisabled({ module, stillAvailable, className }: ModuleDisabledProps) {
  return (
    <div className={['ui-state', 'ui-state--disabled', className].filter(Boolean).join(' ')}>
      <p className="ui-state__title">{module} — module désactivé sur la passerelle</p>
      <p className="ui-state__body">
        Rien n’a échoué : cette section reste vide tant que le module n’est pas activé côté
        passerelle. Son activation est une opération d’exploitation, pas un réglage du tableau de
        bord.
      </p>
      {stillAvailable ? <p className="ui-state__body">{stillAvailable}</p> : null}
    </div>
  )
}
