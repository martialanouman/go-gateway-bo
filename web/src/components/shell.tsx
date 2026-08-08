import type { ReactNode } from 'react'

/**
 * La coquille reprend la silhouette que `index.html` a peinte — rail, barre supérieure, contenu —
 * pour que le passage du squelette à React ne déplace rien à l'écran.
 *
 * Elle est délibérément inerte : la navigation, les permissions et le fil d'Ariane appartiennent à
 * l'AppShell de step-040, qui remplacera ce corps sans déplacer ce composant.
 *
 * **Pourquoi un composant et non la mise en page elle-même.** Deux routes la rendent : `_shell`, qui
 * enveloppe les écrans, et le `notFoundComponent` de la racine — une URL inconnue ne matche aucun
 * enfant de `_shell`, donc son message est rendu *hors* de la mise en page. Sans cette extraction, la
 * garde « une adresse inconnue garde la coquille autour du message » deviendrait fausse ou
 * disparaîtrait, alors qu'elle décrit un comportement voulu : l'opérateur doit pouvoir repartir d'où
 * il est.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <nav className="shell__rail" aria-label="Navigation principale">
        <p className="shell__placeholder">La navigation arrive avec le jalon M2.</p>
      </nav>
      <header className="shell__topbar" />
      <main className="shell__content">{children}</main>
    </div>
  )
}
