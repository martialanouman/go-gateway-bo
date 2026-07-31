/**
 * `/roles` — **route déclarée, écran non encore livré (M1)**.
 *
 * Elle existe dès maintenant pour que la navigation soit complète et qu'aucune entrée du rail ne
 * mène à un lien mort. L'état vide nomme le jalon : « rien ici » et « pas encore construit » sont
 * deux choses différentes, et un opérateur qui tombe sur une page blanche ne peut pas les
 * distinguer.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Page } from '~/components/shell'
import { Empty } from '~/components/states'

export const Route = createFileRoute('/_shell/roles')({
  component: RolesScreen,
})

function RolesScreen() {
  return (
    <Page title="Rôles">
      <Empty
        title="Écran à venir — jalon M1"
        description="Les rôles et le paquet de permissions de chacun. Cette route est déclarée pour que la navigation soit complète ; son contenu arrive au jalon M1."
      />
    </Page>
  )
}
