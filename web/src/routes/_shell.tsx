import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Shell, ShellPending } from '~/components/shell'
import { readSession } from '~/lib/session'

/**
 * La mise en page des écrans du produit — **sans chemin** : le souligné en tête du nom de fichier le
 * dit à TanStack Router, donc `_shell` n'ajoute aucun segment aux URL de ses enfants. `/` reste `/`.
 *
 * Ce qu'elle sépare : ce qui s'adresse à un opérateur, et ce qui ne s'y adresse pas. `/_design` est
 * son **frère**, pas son enfant, et c'est ce qui la met hors de la coquille. La garde de session est
 * posée ici, en `beforeLoad` — la référence visuelle n'a donc pas à s'en exempter, et aucun écran du
 * produit n'a à la redemander.
 *
 * **Elle exige l'élévation, et pas seulement une session.** Ce n'est pas un excès de zèle de l'UI :
 * `requirePermission` (`internal/bff/guard.go`) refuse **toute** opération gardée à une session non
 * élevée, lecture comprise. Sans cette seconde condition, la coquille s'ouvrirait sur des écrans
 * dont chaque appel rendrait 403 — un cockpit qui paraît ouvert et ne répond à rien.
 *
 * **Une panne ne déconnecte pas.** `kind: 'unknown'` laisse passer, et c'est la coquille qui rend
 * l'état d'erreur avec son « Réessayer ». Invariant (e).
 */
export const Route = createFileRoute('/_shell')({
  beforeLoad: async ({ context, location }) => {
    const session = await readSession(context.queryClient)

    // L'accueil n'est pas une destination à rejouer : `?redirect=/` alourdirait toute URL de
    // connexion pour dire ce que son absence dit déjà.
    const requested = location.href === '/' ? undefined : location.href

    if (session.kind === 'none') {
      throw redirect({ to: '/login', search: { redirect: requested, passwordSet: false } })
    }

    if (session.kind === 'open' && !session.me.elevated) {
      // Au second facteur et non à la connexion : le mot de passe vient d'être présenté, et le
      // redemander est exactement la boucle que la v1.0 a livrée.
      throw redirect({ to: '/mfa', search: { redirect: requested } })
    }
  },
  // Ce que l'opérateur voit pendant que la garde décide : la silhouette, et non un blanc.
  pendingComponent: ShellPending,
  component: ShellLayout,
})

function ShellLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}
