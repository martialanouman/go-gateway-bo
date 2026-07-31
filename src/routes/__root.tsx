/// <reference types="vite/client" />
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import appCss from '~/styles/app.css?url'

/**
 * Le contexte du routeur porte le client Query.
 *
 * **Un seul point de création**, dans `getRouter()`. Le créer ici aurait deux défauts : en rendu
 * serveur, un client de module serait partagé entre les requêtes — le cache d'un opérateur servant à
 * un autre — et un client créé dans le composant racine **masquerait** celui qu'un test injecte, ce
 * qui est arrivé et a fait rougir neuf tests d'un coup.
 */
export type RouterContext = { readonly queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
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
  // **Le provider manquait**, et rien ne le disait : `renderComponent` le fournit lui-même, si bien
  // que toute la couche de permissions passait au vert pendant que le rendu serveur levait
  // « No QueryClient set » à chaque requête. C'est le parcours de bout en bout qui l'a trouvé.
  const { queryClient } = Route.useRouteContext()

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
