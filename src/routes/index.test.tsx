/**
 * `/` — la racine ne doit jamais être un cul-de-sac.
 *
 * La page provisoire qui vivait ici annonçait sa disparition en step-040 : elle rendait « Fondations
 * posées » dans son propre `<main>`, hors de la coquille, sans rail et sans lien. C'est exactement
 * la page blanche que `CLAUDE.md` interdit, et c'est la page d'atterrissage par défaut du produit.
 *
 * Elle redirige désormais vers la **première entrée accessible du rail**, donc vers un écran
 * différent selon les permissions — et rend une explication plutôt qu'une boucle quand il n'y en a
 * aucune.
 */

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { renderRoute } from '~/test/render-route'

function clientWithPermissions(permissions: readonly string[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })

  client.setQueryData(OPERATOR_QUERY_KEY, {
    id: 'op-1',
    email: 'operatrice@example.test',
    displayName: 'Opératrice',
    permissions,
    mfaCompleted: true,
  })

  return client
}

describe('la racine', () => {
  it('mène au premier écran accessible', async () => {
    const { findByRole } = await renderRoute('/', {
      queryClient: clientWithPermissions(['connectors:read']),
    })

    // `connectors:read` ouvre « Trafic », première entrée du rail : c'est là qu'un exploitant
    // atterrit.
    expect(await findByRole('heading', { level: 1 })).toHaveTextContent('Trafic')
  })

  it('mène ailleurs selon les permissions', async () => {
    const { findByRole } = await renderRoute('/', {
      queryClient: clientWithPermissions(['billing:read']),
    })

    expect(await findByRole('heading', { level: 1 })).toHaveTextContent('Facturation')
  })

  it('explique plutôt que de boucler quand aucun écran n’est accessible', async () => {
    // Rediriger vers une route qui redirigerait en retour ferait tourner le routeur indéfiniment.
    const { findByText } = await renderRoute('/', { queryClient: clientWithPermissions([]) })

    expect(await findByText(/Aucun écran n’est accessible/)).toBeInTheDocument()
  })

  it('montre un squelette plutôt qu’un blanc pendant l’attente', async () => {
    const empty = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { findByRole } = await renderRoute('/', { queryClient: empty })

    expect(await findByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})
