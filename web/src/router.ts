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
 */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, scrollRestoration: true, ...(history ? { history } : {}) })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
