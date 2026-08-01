import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'

/** Le contexte du routeur porte le client Query, créé une seule fois dans `main.tsx`. */
export type RouterContext = { readonly queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  // **Le provider vit dans l'application, pas dans le harnais.** La v1.0 a livré
  // une application sans lui pendant que tous les tests de composant passaient,
  // parce que `renderComponent` le fournissait lui-même.
  const { queryClient } = Route.useRouteContext()

  return (
    <QueryClientProvider client={queryClient}>
      <RetraitDuSquelette />
      <Outlet />
    </QueryClientProvider>
  )
}

/**
 * Le squelette du document cède la place au premier rendu réel — pas avant.
 * Le retirer depuis l'entrée, juste après `render()`, ferait clignoter un blanc :
 * React 19 peint de façon asynchrone, et le squelette serait parti avant que
 * quoi que ce soit ne l'ait remplacé.
 */
function RetraitDuSquelette() {
  useEffect(() => {
    document.getElementById('squelette')?.remove()
  }, [])

  return null
}
