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
 * navigation sur un aller-retour réseau.
 *
 * ## La garde de session s'applique ici aussi (step-026)
 *
 * Cette route est sœur de `_shell`, pas fille : la garde de la coquille ne la voit pas. Elle est
 * pourtant **l'URL la plus tapée du produit**, et sans garde un anonyme y lisait « Aucun écran n'est
 * accessible avec les permissions de ce compte. Demandez un rôle à un administrateur. » — une copie
 * qui impute à un problème de rôle ce qui est une absence de session. Pire pour un opérateur
 * légitime : arrivé ici juste après son second facteur, si la relecture de `/auth/me` avait échoué,
 * il s'entendait dire qu'il n'a aucun droit.
 */

import { createFileRoute, Navigate } from '@tanstack/react-router'
import { SessionBoundary } from '~/components/auth/session-boundary'
import { sessionRedirect, useSessionStatus } from '~/components/auth/session-gate'
import { useCurrentOperator } from '~/components/permission'
import { NAV_ENTRIES } from '~/components/shell'

export const Route = createFileRoute('/')({
  component: HomeRedirect,
})

function HomeRedirect() {
  const { data: operator } = useCurrentOperator()
  const { status, retry } = useSessionStatus()
  const to = sessionRedirect(status)

  // `Navigate` et non un effet : rien n'est encore peint ici, et il n'y a donc rien à interrompre.
  if (to) return <Navigate replace to={to} />

  if (status !== 'complete') {
    return (
      <SessionBoundary
        label="Ouverture du tableau de bord"
        retry={retry}
        rows={3}
        status={status}
      />
    )
  }

  const granted = new Set<string>(operator?.permissions ?? [])
  const first = NAV_ENTRIES.find((entry) => granted.has(entry.permission))

  // Sans aucune entrée accessible, on reste sur place : rediriger vers une route qui redirigerait
  // en retour ferait boucler le routeur. La session est **complète** à ce point — la garde ci-dessus
  // l'a établie — donc c'est bien un problème de rôle, et la copie peut le dire.
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
