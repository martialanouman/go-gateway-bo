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
 * neutraliserait ce `beforeLoad` dans son navigateur verrait une coquille vide et se ferait refuser
 * chaque appel.
 */

import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { operatorQueryOptions } from '~/components/permission'
import { AppShell } from '~/components/shell'

export const Route = createFileRoute('/_shell')({
  beforeLoad: async ({ context }) => {
    // **Côté navigateur seulement.** Le cookie de session est `HttpOnly` et voyage avec la requête
    // du navigateur ; en rendu serveur, ce `fetch` partirait sans lui, avec une URL relative que
    // Node ne sait pas résoudre. Le rendu initial montre donc la coquille en chargement, et la
    // redirection tombe à l'hydratation — ce que `e2e/connexion.spec.ts` vérifie dans un vrai
    // navigateur, puisque aucun test jsdom ne peut établir ce qu'un rendu serveur produit.
    if (typeof window === 'undefined') return

    const operator = await context.queryClient.ensureQueryData(operatorQueryOptions())

    if (!operator) throw redirect({ to: '/connexion' })

    // Une session partielle ne porte **aucune** permission : la laisser entrer afficherait une
    // console entièrement grisée, sans dire ce qui manque.
    if (!operator.mfaCompleted) throw redirect({ to: '/connexion/verification' })
  },
  component: ShellLayout,
})

function ShellLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
