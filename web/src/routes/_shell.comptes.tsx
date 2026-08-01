/**
 * `/comptes` — **route déclarée, écran non encore livré (M3)**.
 *
 * Elle existe dès maintenant pour que la navigation soit complète et qu'aucune entrée du rail ne
 * mène à un lien mort. L'état vide nomme le jalon : « rien ici » et « pas encore construit » sont
 * deux choses différentes, et un opérateur qui tombe sur une page blanche ne peut pas les
 * distinguer.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Page } from '~/components/shell'
import { Empty } from '~/components/states'

export const Route = createFileRoute('/_shell/comptes')({
  component: ComptesScreen,
})

function ComptesScreen() {
  return (
    <Page title="Comptes SMPP">
      <Empty
        title="Écran à venir — jalon M3"
        description="Les comptes SMPP, leurs canaux, quotas et max_sessions. Cette route est déclarée pour que la navigation soit complète ; son contenu arrive au jalon M3."
      />
    </Page>
  )
}
