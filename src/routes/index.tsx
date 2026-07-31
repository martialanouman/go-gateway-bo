/**
 * `/` — **redirige vers la première entrée accessible du rail**.
 *
 * La page provisoire qui vivait ici annonçait elle-même sa disparition en step-040. La supprimer
 * sans rien mettre à la place aurait laissé la racine en 404 ; la garder aurait laissé un
 * cul-de-sac hors de la coquille, sans rail et sans lien — exactement la « page blanche » que
 * `CLAUDE.md` interdit.
 *
 * La cible dépend des permissions, donc de `/auth/me` : un `billing_readonly` atterrit sur
 * Facturation, un `ops` sur Trafic. Un opérateur sans aucune permission voit la coquille avec un
 * rail vide plutôt qu'une redirection en boucle.
 *
 * La redirection est décidée **au rendu** et non dans un `beforeLoad` : les permissions viennent
 * d'une requête client, et un `beforeLoad` devrait l'attendre — ce qui bloquerait la première
 * navigation sur un aller-retour réseau. La garde de session, elle, ira sur `_shell` en step-026.
 */

import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useCurrentOperator } from '~/components/permission'
import { NAV_ENTRIES } from '~/components/shell'
import { Loading } from '~/components/states'

export const Route = createFileRoute('/')({
  component: HomeRedirect,
})

function HomeRedirect() {
  const { data: operator, isPending } = useCurrentOperator()

  if (isPending) return <Loading label="Ouverture du tableau de bord" rows={3} />

  const granted = new Set<string>(operator?.permissions ?? [])
  const first = NAV_ENTRIES.find((entry) => granted.has(entry.permission))

  // Sans aucune entrée accessible, on reste sur place : rediriger vers une route qui redirigerait
  // en retour ferait boucler le routeur.
  if (!first) {
    return (
      <main>
        <h1>Tableau de bord</h1>
        <p>
          Aucun écran n’est accessible avec les permissions de ce compte. Demandez un rôle à un
          administrateur.
        </p>
      </main>
    )
  }

  return <Navigate replace to={first.to} />
}
