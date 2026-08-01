import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { promouvoirFeuillesDifferees } from './lib/feuilles-differees'
import { routeTree } from './routeTree.gen'
import './styles/app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Les écrans sont denses et l'opérateur navigue vite : refaire chaque
      // requête à chaque retour chargerait la passerelle pour rien.
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  // Desktop-first sur réseau interne : précharger au survol supprime l'attente
  // perçue sans coût mesurable.
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// La feuille de styles est chargée en `media="print"` pour ne pas bloquer le
// premier paint du squelette (voir `vite.config.ts`). On la promeut avant de
// monter React.
//
// Risque résiduel assumé, faute de pouvoir le mesurer avant step-007 : la
// promotion ne fait pas *attendre* la feuille. Si le bundle arrive avant elle
// — plausible, une feuille `media="print"` est récupérée en priorité basse —
// la console peut apparaître non stylée le temps d'un aller-retour. Le motif
// canonique bascule `media` dans `onload`, que le nonce CSP de step-186
// interdit. Le parcours de bout en bout devra asserter « premier rendu déjà
// stylé ».
promouvoirFeuillesDifferees(document)

const point = document.getElementById('root')
if (!point) {
  throw new Error('#root est absent du document : index.html et main.tsx ont divergé')
}

createRoot(point).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
