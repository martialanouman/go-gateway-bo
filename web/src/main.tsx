import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import './styles/app.css'

const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

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
