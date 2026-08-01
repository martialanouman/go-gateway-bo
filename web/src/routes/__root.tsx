import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({ component: RootLayout, notFoundComponent: NotFound })

/**
 * La coquille reprend la silhouette que `index.html` a peinte — rail, barre supérieure, contenu — pour
 * que le passage du squelette à React ne déplace rien à l'écran.
 *
 * Elle est délibérément inerte : la navigation, les permissions et le fil d'Ariane appartiennent à
 * l'AppShell de step-040.
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

/**
 * Sans cette route de repli, TanStack rend `<p>Not Found</p>` — en anglais, hors des cinq états, et
 * sans dire quoi faire. Le cas n'est pas marginal : step-002 renvoie **toute** URL inconnue vers ce
 * document, donc c'est ici qu'atterrit une adresse mal recopiée.
 */
function NotFound() {
  return (
    <section className="empty">
      <h1 className="empty__title">Cette adresse ne correspond à aucun écran</h1>
      <p className="empty__body">
        Le lien est peut-être incomplet, ou l'écran n'est pas encore livré. Les écrans arrivent
        jalon par jalon, et chacun apparaît dans la navigation dès qu'il existe.
      </p>
    </section>
  )
}
