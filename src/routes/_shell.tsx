/**
 * La route de mise en page **sans chemin** qui porte la coquille.
 *
 * ## Pourquoi une route de mise en page et non `__root.tsx`
 *
 * Parce que toutes les pages ne vivent pas dans la coquille. `/_design` est une référence interne
 * qui s'adresse à qui écrit un écran, pas à un opérateur : l'entourer d'un rail de navigation serait
 * faux. Et l'écran de login (step-026) est public par définition — il ne peut pas être rendu sous
 * une barre qui affiche le nom de l'opérateur connecté.
 *
 * Le souligné en fait un segment **sans chemin** : `/trafic` reste `/trafic`, il hérite simplement
 * de cette mise en page.
 *
 * ## La garde de session (step-026)
 *
 * C'est le point que la note ‡ de l'INDEX désignait : `resolveSession()` existe depuis la step-022
 * et attendait « une route à garder ». La voici — un `beforeLoad` ici protège d'un coup tous les
 * écrans que la coquille enveloppe, sans qu'aucun d'eux ait à y penser. Une garde par écran aurait
 * tenu jusqu'au premier écran ajouté sans elle, et cet écran-là aurait été le seul ouvert.
 *
 * **Elle redirige, elle ne protège pas.** La protection vit dans le BFF : chaque handler revérifie
 * la session, et `requirePermission()` revérifie les droits (invariant c). Un opérateur qui
 * neutraliserait cette garde dans son navigateur verrait une coquille vide et se ferait refuser
 * chaque appel.
 *
 * **Deux points d'application, une seule règle** — `sessionRedirect()`. Le `beforeLoad` refuse la
 * route avant de monter l'écran, ce qui vaut pour une navigation interne ; il ne s'exécute pas sur
 * une **ouverture directe d'URL**, puisque le rendu serveur ne peut pas lire un cookie `HttpOnly` et
 * que le routeur ne rejoue pas `beforeLoad` à l'hydratation. Le composant reprend donc la main. Ce
 * trou-là avait passé trois tests de route au vert avant que le parcours de bout en bout ne le
 * trouve.
 */

import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { sessionRedirect } from '~/components/auth/session-gate'
import { operatorQueryOptions, useCurrentOperator } from '~/components/permission'
import { AppShell } from '~/components/shell'

export const Route = createFileRoute('/_shell')({
  beforeLoad: async ({ context }) => {
    // **Côté navigateur seulement.** Le cookie de session est `HttpOnly` et voyage avec la requête
    // du navigateur ; en rendu serveur, ce `fetch` partirait sans lui, avec une URL relative que
    // Node ne sait pas résoudre. C'est aussi pourquoi le composant reprend la main — voir l'en-tête.
    if (typeof window === 'undefined') return

    const to = sessionRedirect(await context.queryClient.ensureQueryData(operatorQueryOptions()))

    if (to) throw redirect({ to })
  },
  component: ShellLayout,
})

function ShellLayout() {
  const navigate = useNavigate()
  const { data: operator } = useCurrentOperator()
  const to = sessionRedirect(operator)

  // Dans un effet, et non pendant le rendu : naviguer pendant le rendu d'un composant est refusé par
  // React, et le ferait au milieu de la peinture de la coquille.
  useEffect(() => {
    if (to) void navigate({ to, replace: true })
  }, [to, navigate])

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
