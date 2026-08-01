import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import '~/styles/app.css'

// Pas de `defaultPreload: 'intent'`. Survoler un lien déclencherait le loader de la route visée,
// donc un vrai appel au BFF : sur les écrans de contenu, cela dépenserait `content:read` et écrirait
// une entrée d'audit pour une lecture que personne n'a faite. Le journal d'audit est la preuve de
// l'invariant (a) ; le remplir de lectures fictives l'affaiblit en tant que preuve. Le préchargement
// se décidera route par route, là où l'on sait ce qu'il coûte.
const router = createRouter({ routeTree, scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const container = document.getElementById('app')
if (container === null) {
  throw new Error('le point de montage #app est absent du document servi')
}

// `createRoot(...).render()` remplace le squelette peint par `index.html`. L'exemple officiel de
// TanStack garde ce montage derrière un `if (!rootElement.innerHTML)`, hérité du rendu serveur : ici
// il empêcherait purement et simplement l'application de démarrer, puisque le conteneur n'est jamais
// vide — c'est tout l'objet du chargement à froid (§1.9).
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
