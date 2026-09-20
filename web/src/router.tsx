import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * La fabrique du routeur, partagée par l'application et par ses tests.
 *
 * Sans elle, chaque test reconstruisait le sien : il aurait suffi qu'une option divergeât — un
 * préchargement, une restauration de défilement — pour que les tests décrivent un routeur que
 * personne n'exécute. C'est le harnais qui masque, et il a déjà coûté à ce projet.
 *
 * Pas de `defaultPreload`. Survoler un lien déclencherait le loader de la route visée, donc un vrai
 * appel au BFF : sur les écrans de contenu, cela dépenserait `content:read` et écrirait une entrée
 * d'audit pour une lecture que personne n'a faite. Le journal d'audit est la preuve de l'invariant
 * (a) ; le remplir de lectures fictives l'affaiblit en tant que preuve. Le préchargement se décidera
 * route par route, là où l'on sait ce qu'il coûte.
 *
 * **Le `QueryClient` naît ici**, et `Wrap` le fournit : l'application et chaque test passent par la
 * même fabrique, donc par le même provider. Un client par routeur, aussi, pour qu'aucun cache ne
 * survive d'un test au suivant.
 */
export function createAppRouter(history?: RouterHistory) {
  const queryClient = new QueryClient()

  return createRouter({
    routeTree,
    // Le même client que `Wrap` fournit, et non un second : les gardes décident sur ce que les
    // écrans afficheront.
    context: { queryClient },

    // Zéro, et non le délai d'une seconde que TanStack applique par défaut. Ce délai sert à éviter
    // un clignotement sur une attente brève ; ici il produit l'inverse — la garde de session
    // s'exécute avant tout rendu, donc l'écran resterait **vide** pendant ce temps, juste après que
    // `index.html` a peint sa silhouette. Chaque route porte son propre `pendingComponent`.
    defaultPendingMs: 0,
    scrollRestoration: true,
    ...(history ? { history } : {}),
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
