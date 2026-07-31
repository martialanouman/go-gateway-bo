/// <reference types="vite/client" />
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useState } from 'react'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Tableau de bord — Passerelle SMS' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  /**
   * Le client Query de l'application.
   *
   * **Il manquait**, et rien ne le disait : les tests de composant le fournissent eux-mêmes par
   * `renderComponent`, si bien que toute la couche de permissions passait au vert pendant que
   * l'application réelle levait « No QueryClient set » au premier rendu serveur. C'est le parcours
   * de bout en bout qui l'a trouvé — un cas d'école de ce qu'un test unitaire ne peut pas voir.
   *
   * Créé dans un `useState` et non au niveau du module : en rendu serveur, un client de module
   * serait **partagé entre les requêtes**, et le cache d'un opérateur servirait à un autre.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Les écrans sont denses et l'opérateur navigue vite : refaire chaque requête à chaque
            // retour sur un écran chargerait la passerelle pour rien.
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  )

  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  // `lang="fr"` porte plus qu'une convention : les lecteurs d'écran choisissent leur prononciation
  // dessus, et la copie du produit est en français (§1.7 du plan d'exécution).
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
