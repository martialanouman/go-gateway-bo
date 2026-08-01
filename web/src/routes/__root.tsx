import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: RootLayout })

/**
 * La coquille reprend la silhouette que `index.html` a peinte — rail, barre supérieure, contenu — pour
 * que le passage du squelette à React ne déplace rien à l'écran.
 *
 * Elle est délibérément inerte : la navigation, les permissions et le fil d'Ariane appartiennent à
 * l'AppShell de step-040. Ce qui est ici est la structure, pas encore le meuble.
 */
function RootLayout() {
  return (
    <div className="shell">
      <nav className="shell__rail" aria-label="Navigation principale">
        <p className="shell__placeholder">La navigation arrive avec le jalon M2.</p>
      </nav>
      <header className="shell__topbar" />
      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  )
}
