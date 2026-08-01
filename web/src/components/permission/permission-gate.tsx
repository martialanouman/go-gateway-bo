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
  /**
   * Le contrôle à peindre. **Il doit accepter `blocked`** — c'est-à-dire être un `Button` du lot 1,
   * ou un composant qui implémente le même couple `aria-disabled` + neutralisation du clic.
   *
   * Le typage l'exige désormais, et ce n'était pas le cas : une version précédente annonçait
   * « accepte `aria-disabled` et `aria-describedby` », or `aria-disabled` posé ici est **écrasé**
   * par `Button` et n'empêche rien sur un `<a href>`. Un écran aurait donc pu envelopper un lien,
   * le voir grisé avec sa raison — et le lien aurait navigué. Le contrat est maintenant vérifié à la
   * compilation plutôt que décrit dans une phrase.
   */
  readonly children: ReactElement<{
    blocked?: boolean
    'aria-describedby'?: string
  }>
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
      {cloneElement(children, {
        // `blocked` seul : c'est lui qui porte **à la fois** l'annonce `aria-disabled` et la
        // neutralisation du clic (voir `button.tsx`). Poser `aria-disabled` ici en plus serait au
        // mieux redondant — `Button` l'écrase — et au pire trompeur, en laissant croire qu'un
        // enfant quelconque serait neutralisé.
        blocked: true,
        'aria-describedby': reasonId,
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
