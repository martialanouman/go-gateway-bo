/**
 * `/trafic` — **route déclarée, écran non encore livré (M4)**.
 *
 * Elle existe dès maintenant pour que la navigation soit complète et qu'aucune entrée du rail ne
 * mène à un lien mort. L'état vide nomme le jalon : « rien ici » et « pas encore construit » sont
 * deux choses différentes, et un opérateur qui tombe sur une page blanche ne peut pas les
 * distinguer.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Page } from '~/components/shell'
import { Empty } from '~/components/states'

export const Route = createFileRoute('/_shell/trafic')({
  component: TraficScreen,
})

function TraficScreen() {
  return (
    <Page title="Trafic">
      <Empty
        title="Écran à venir — jalon M4"
        description="Le trafic en direct, les métriques et le débit par connecteur. Cette route est déclarée pour que la navigation soit complète ; son contenu arrive au jalon M4."
      />
    </Page>
  )
}
