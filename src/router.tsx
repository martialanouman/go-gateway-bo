import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Point d'entrée du routeur, appelé par TanStack Start au rendu serveur comme au démarrage client.
 * Le nom `getRouter` est imposé par le plugin Vite : il l'importe pour typer le registre.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Les écrans sont denses et l'opérateur navigue vite : refaire chaque requête à chaque
        // retour chargerait la passerelle pour rien.
        staleTime: 30_000,
        retry: 1,
      },
    },
  })

  return createRouter({
    routeTree,
    context: { queryClient },
    // L'outil est dense et desktop-first : précharger au survol évite l'attente perçue en
    // navigation, sans coût mesurable sur un réseau interne.
    defaultPreload: 'intent',
    scrollRestoration: true,
  })
}
