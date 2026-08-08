import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Coquille } from '~/components/coquille'

/**
 * La mise en page des écrans du produit — **sans chemin** : le souligné en tête du nom de fichier le
 * dit à TanStack Router, donc `_shell` n'ajoute aucun segment aux URL de ses enfants. `/` reste `/`.
 *
 * Ce qu'elle sépare : ce qui s'adresse à un opérateur, et ce qui ne s'y adresse pas. `/_design` est
 * son **frère**, pas son enfant, et c'est ce qui la met hors de la coquille. La garde de session de
 * M1 se posera ici, en `beforeLoad` — la référence visuelle n'aura donc pas à s'en exempter.
 */
export const Route = createFileRoute('/_shell')({ component: ShellLayout })

function ShellLayout() {
  return (
    <Coquille>
      <Outlet />
    </Coquille>
  )
}
