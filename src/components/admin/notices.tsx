/**
 * Les deux façons dont l'annuaire dit non.
 *
 * ## Pourquoi un bandeau, et jamais un toast
 *
 * Un refus de l'annuaire nomme la clé qui manque — « la permission « operators:manage » » — et cite
 * donc entre guillemets. `assertToastText` refuse exactement cette forme, et **lève** : le passer en
 * toast ferait planter le gestionnaire de clic au lieu d'afficher le refus. Ce n'est pas une
 * limitation à contourner, c'est la bonne place — un toast s'efface au bout de quelques secondes,
 * et un refus se lit, se relit, et parfois se recopie dans un message à l'administrateur d'à côté.
 */

import type { PermissionKey } from '~/lib/permissions'

export type RefusalNoticeProps = {
  /** Le message du serveur, **verbatim**. Aucune reformulation ici : voir `api.ts`. */
  readonly message: string
}

export function RefusalNotice({ message }: RefusalNoticeProps) {
  // `role="alert"` : le refus arrive après une action volontaire, et doit être annoncé sans que
  // l'opérateur ait à repartir à sa recherche dans la page.
  return (
    <p className="ui-directory__refusal" role="alert">
      {message}
    </p>
  )
}

export type PermissionRequiredProps = {
  readonly permission: PermissionKey
  /** Ce que l'écran aurait montré. Complète la clé, qui ne parle qu'aux initiés. */
  readonly what: string
}

/**
 * L'écran qu'un opérateur voit quand il colle l'URL d'une surface qu'il n'a pas.
 *
 * **Expliqué, jamais une page blanche ni une erreur.** Le rail de navigation ne montre déjà pas
 * l'entrée (step-040) ; celui qui arrive ici a suivi un lien d'un collègue, et ce qu'il lui faut est
 * le nom de la clé à demander. Le serveur refuserait de toute façon la lecture — cet écran évite le
 * détour par un `403` peint en panne.
 */
export function PermissionRequired({ permission, what }: PermissionRequiredProps) {
  return (
    <div className="ui-directory__blocked">
      <p className="ui-directory__blocked-title">
        {what} demande une permission que vous n’avez pas
      </p>
      <p className="ui-directory__blocked-body">
        Cet écran est réservé aux comptes qui détiennent{' '}
        <code className="ui-directory__key">{permission}</code>. Demandez-la à un administrateur :
        la clé s’attribue par un rôle, depuis l’écran des rôles.
      </p>
    </div>
  )
}
