/**
 * La route de mise en page **sans chemin** qui porte la coquille.
 *
 * ## Pourquoi une route de mise en page et non `__root.tsx`
 *
 * Parce que toutes les pages ne vivent pas dans la coquille. `/_design` est une référence interne
 * qui s'adresse à qui écrit un écran, pas à un opérateur : l'entourer d'un rail de navigation serait
 * faux. Et l'écran de login (step-026) est public par définition — il ne peut pas être rendu sous
 * une barre qui affiche le nom de l'opérateur connecté.
 *
 * Le souligné en fait un segment **sans chemin** : `/trafic` reste `/trafic`, il hérite simplement
 * de cette mise en page.
 *
 * ## Ce que step-026 posera ici
 *
 * La garde de session. C'est le point que la note ‡ de l'INDEX désignait : `resolveSession()` existe
 * depuis la step-022 et attendait « une route à garder ». La voici — un `beforeLoad` sur cette route
 * protégera d'un coup tous les écrans qu'elle enveloppe, sans qu'aucun d'eux ait à y penser.
 */

import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '~/components/shell'

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
})

function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
