/**
 * **Aucune page blanche.** Chaque route déclarée rend un état vide explicite.
 *
 * C'est une exigence de la step-040, et elle protège une chose précise : la différence entre « il
 * n'y a rien ici » et « ce n'est pas encore construit ». Un opérateur qui tombe sur un écran nu ne
 * peut pas les distinguer — il conclut à un bug, ou à un droit manquant, et ouvre un ticket.
 *
 * Le test est **table-driven sur la carte de navigation** : ajouter une entrée au rail sans lui
 * écrire de route fait donc rougir cette suite. C'est le seul endroit qui relie les deux.
 */

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { NAV_ENTRIES } from '~/components/shell'
import { renderRoute } from '~/test/render-route'

/** Un `super_admin` : toutes les entrées du rail sont visibles, tous les écrans atteignables. */
function omniscientClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })

  client.setQueryData(OPERATOR_QUERY_KEY, {
    id: 'op-1',
    email: 'operatrice@example.test',
    displayName: 'Opératrice',
    permissions: NAV_ENTRIES.map((entry) => entry.permission),
    mfaCompleted: true,
  })

  return client
}

/**
 * Les écrans **livrés**, qui ne doivent plus annoncer leur jalon.
 *
 * Cette liste grandit d'une step à l'autre, et c'est son intérêt : elle rend la livraison d'un écran
 * visible dans un diff, et elle refuse les deux régressions symétriques — un écran livré qui
 * retomberait sur son placeholder, et un écran non livré qui n'annoncerait plus rien.
 */
const LIVRES: ReadonlySet<string> = new Set(['/operateurs', '/roles'])

describe('les écrans déclarés', () => {
  it.each(NAV_ENTRIES.map((entry) => [entry.to, entry.label]))(
    '%s rend un titre, et dit s’il est construit ou non',
    async (to, label) => {
      const { getByRole, queryByText } = await renderRoute(to, {
        queryClient: omniscientClient(),
      })

      // Un titre, donc un repère de niveau 1 : c'est ce qui dit à un lecteur d'écran où il arrive.
      expect(getByRole('heading', { level: 1 })).toHaveTextContent(label)

      // L'état vide **nomme le jalon** tant que l'écran n'existe pas : « pas encore construit » se
      // dit, il ne se devine pas devant un écran nu. Et il disparaît quand l'écran arrive.
      const aVenir = queryByText(/Écran à venir — jalon M\d/)

      if (LIVRES.has(to)) expect(aVenir).toBeNull()
      else expect(aVenir).toBeInTheDocument()
    },
  )

  it('n’est jamais rendu comme une erreur', async () => {
    // Une route non encore livrée n'est pas une panne. La peindre en rouge ferait ouvrir un ticket
    // pour un écran que personne n'a encore écrit.
    const { queryByRole } = await renderRoute('/audit', { queryClient: omniscientClient() })

    expect(queryByRole('alert')).toBeNull()
  })
})
