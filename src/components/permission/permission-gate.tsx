/**
 * Le rendu conditionnel par permission — **un confort, jamais une garde**.
 *
 * ## La règle de la charte, et pourquoi elle est contre-intuitive
 *
 * « Un contrôle interdit est **désactivé et expliqué**, jamais silencieusement masqué. » Le réflexe
 * est l'inverse : on masque ce qui ne sert pas, pour alléger. Mais un contrôle absent apprend à
 * l'opérateur que la fonction n'existe pas — il cherche alors un contournement, ouvre un ticket, ou
 * conclut à un bug. Un contrôle désactivé qui nomme sa permission lui dit exactement quoi demander.
 *
 * ## Et l'invariant (c)
 *
 * Ce composant ne protège rien. Il peint. L'autorisation vit dans `requirePermission()` côté
 * serveur, et un contrôle masqué dont la route n'est pas gardée reste une faille — c'est écrit dans
 * `src/server/authz/permission.ts` et cela vaut d'être répété ici, parce que c'est ici qu'on serait
 * tenté de croire le contraire.
 */

import type { ReactElement, ReactNode } from 'react'
import { cloneElement, isValidElement, useId } from 'react'
import type { PermissionKey } from '~/lib/permissions'
import { usePermission } from './use-permission'

export type PermissionGateProps = {
  readonly permission: PermissionKey
  /** Le contrôle à garder. Doit accepter `aria-disabled` et `aria-describedby`. */
  readonly children: ReactElement
  /**
   * Masquer au lieu de désactiver. **À demander explicitement, jamais par défaut.**
   *
   * Le seul cas légitime est une entrée de navigation vers une section entièrement inaccessible :
   * la désactiver laisserait un rail encombré d'entrées mortes, sans rien apprendre à personne.
   * Partout ailleurs, masquer contredit la charte.
   */
  readonly hideWhenDenied?: boolean
  /** Précision de refus, quand la clé seule ne suffit pas à comprendre. */
  readonly reason?: ReactNode
}

export function PermissionGate({
  permission,
  children,
  hideWhenDenied = false,
  reason,
}: PermissionGateProps) {
  const { granted } = usePermission(permission)
  const reasonId = useId()

  // Inconnu ≠ refusé : voir `usePermission`. On ne rend rien plutôt que de faire clignoter un
  // contrôle d'actif à désactivé sous le curseur.
  if (granted === undefined) return null

  if (granted) return children

  if (hideWhenDenied) return null

  if (!isValidElement(children)) return null

  return (
    <span className="ui-permission-gate">
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        'aria-disabled': true,
        'aria-describedby': reasonId,
        // Le contrôle reste dans le parcours clavier — c'est la moitié « expliqué » de la règle :
        // un `disabled` nu le retirerait de l'arbre, et l'explication ne serait jamais lue.
        blocked: true,
      })}
      <span className="ui-permission-gate__reason" id={reasonId}>
        {reason ?? (
          <>
            Nécessite la permission <code>{permission}</code>.
          </>
        )}
      </span>
    </span>
  )
}
