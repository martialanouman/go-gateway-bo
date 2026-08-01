import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAppRouter } from '~/router'
import '~/styles/app.css'

const container = document.getElementById('app')
if (container === null) {
  throw new Error('le point de montage #app est absent du document servi')
}

// `createRoot(...).render()` remplace le squelette peint par `index.html`. L'exemple officiel de
// TanStack garde ce montage derrière un `if (!rootElement.innerHTML)` : ici il empêcherait purement
// et simplement l'application de démarrer, puisque le conteneur n'est jamais vide — c'est tout
// l'objet du chargement à froid (§1.9).
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter()} />
  </StrictMode>,
)
