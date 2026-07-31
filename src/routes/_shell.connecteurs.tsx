/**
 * `/connecteurs` — **route déclarée, écran non encore livré (M5)**.
 *
 * Elle existe dès maintenant pour que la navigation soit complète et qu'aucune entrée du rail ne
 * mène à un lien mort. L'état vide nomme le jalon : « rien ici » et « pas encore construit » sont
 * deux choses différentes, et un opérateur qui tombe sur une page blanche ne peut pas les
 * distinguer.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Page } from '~/components/shell'
import { Empty } from '~/components/states'

export const Route = createFileRoute('/_shell/connecteurs')({
  component: ConnecteursScreen,
})

function ConnecteursScreen() {
  return (
    <Page title="Connecteurs">
      <Empty
        title="Écran à venir — jalon M5"
        description="Les connecteurs, leur pool de binds, link_status et breaker_state. Cette route est déclarée pour que la navigation soit complète ; son contenu arrive au jalon M5."
      />
    </Page>
  )
}
