/**
 * Le rendu d'un **écran** de test — c'est-à-dire d'une route réelle du produit.
 *
 * Séparé de `renderComponent` parce que l'objet testé n'est pas le même : ici, on monte l'arbre de
 * routes généré, à une URL donnée, avec le client Query. C'est ce qui permet de vérifier qu'une
 * route existe vraiment, que son composant se monte, et que la navigation fonctionne — trois choses
 * qu'un composant monté nu ne dit pas.
 *
 * L'arbre vient de `routeTree.gen.ts`, donc du fichier commité. Un test ne verra jamais qu'une
 * route a été ajoutée sans régénérer l'arbre : c'est la porte `build` de la CI qui l'attrape, en
 * refusant un diff sur ce fichier.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render as renderWithTestingLibrary } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routeTree } from '~/routeTree.gen'
import { createTestQueryClient, type RenderResult } from './render'

/** Monte le produit à l'URL demandée. */
export function renderRoute(path: string): RenderResult {
  const queryClient = createTestQueryClient()
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  const result = renderWithTestingLibrary(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { ...result, user: userEvent.setup(), queryClient }
}
