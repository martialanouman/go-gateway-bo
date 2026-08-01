/**
 * Le rendu des tests de composant.
 *
 * Un composant du produit vit dans trois contextes : un routeur, un client TanStack Query, et les
 * tokens de la charte. Un test qui monte le composant nu teste autre chose que ce qui sera livré —
 * et découvre en production qu'un `useQuery` sans provider lève, ou qu'un `Link` sans routeur ne
 * navigue pas. Ce helper reconstitue les trois.
 *
 * Deux réglages de `QueryClient` sont propres au test et méritent d'être dits :
 *
 * - `retry: false` — en production, une requête qui échoue est reprise ; dans un test, cette reprise
 *   transforme un échec immédiat en attente de plusieurs secondes puis en dépassement de délai, et
 *   le message d'erreur ne parle plus de la cause.
 * - `gcTime: Infinity` avec un client **neuf par test** — un cache partagé entre deux tests les
 *   rendrait dépendants de leur ordre d'exécution, ce qui est la façon la plus sûre de fabriquer un
 *   test intermittent.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type RenderOptions, render as renderWithTestingLibrary } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'

export type RenderResult = ReturnType<typeof renderWithTestingLibrary> & {
  /** Une session `user-event` déjà démarrée : chaque test interagit comme un opérateur, pas par `fireEvent`. */
  user: ReturnType<typeof userEvent.setup>
  queryClient: QueryClient
}

/** Un client par test. Ne jamais le hisser en module : le cache fuiterait d'un test à l'autre. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Monte un composant avec les contextes du produit.
 *
 * Pour un écran entier — donc une route — il faut le routeur : `renderRoute` de
 * `src/test/render-route.tsx` fait cela. Ce helper-ci sert aux composants isolés.
 */
export function renderComponent(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient } = {},
): RenderResult {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options

  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  const result = renderWithTestingLibrary(ui, { wrapper: Providers, ...renderOptions })

  // `userEvent.setup()` avant le rendu serait perdu : la session s'attache au document courant.
  return { ...result, user: userEvent.setup(), queryClient }
}
