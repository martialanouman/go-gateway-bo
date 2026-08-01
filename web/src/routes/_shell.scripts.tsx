/**
 * `/scripts` — **route déclarée, écran non encore livré (M6)**.
 *
 * Elle existe dès maintenant pour que la navigation soit complète et qu'aucune entrée du rail ne
 * mène à un lien mort. L'état vide nomme le jalon : « rien ici » et « pas encore construit » sont
 * deux choses différentes, et un opérateur qui tombe sur une page blanche ne peut pas les
 * distinguer.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Page } from '~/components/shell'
import { Empty } from '~/components/states'

export const Route = createFileRoute('/_shell/scripts')({
  component: ScriptsScreen,
})

function ScriptsScreen() {
  return (
    <Page title="Scripts">
      <Empty
        title="Écran à venir — jalon M6"
        description="Les scripts de routage et leurs versions. Cette route est déclarée pour que la navigation soit complète ; son contenu arrive au jalon M6."
      />
    </Page>
  )
}
