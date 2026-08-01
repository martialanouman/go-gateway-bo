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
 * **Dans le composant, et non dans un `beforeLoad`.** Le premier jet gardait la route : il ne
 * s'exécutait jamais sur une **ouverture directe d'URL**, puisque le rendu serveur ne peut pas lire
 * un cookie `HttpOnly` et que le routeur ne rejoue pas `beforeLoad` à l'hydratation. Coller une URL
 * entrait donc dans la console sans session, et trois tests de route déclaraient la garde verte —
 * c'est `e2e/connexion.spec.ts` qui l'a trouvé.
 *
 * Le réflexe suivant a été d'ajouter le composant **en plus** de la route. Deux applications d'une
 * même règle, dont l'une portait un cas que rien ne pouvait exercer : le `beforeLoad` ne redirigeait
 * plus jamais avant le composant, sa branche « rendu serveur » était intestable, et la couverture
 * l'a signalé. Une seule application, celle qui couvre tous les chemins.
 *
 * Le prix est visible et assumé : sur une navigation interne, la coquille se monte le temps d'une
 * image avant de repartir. Le prix de l'autre était une branche que personne n'aurait pu vérifier.
 */

import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SessionBoundary } from '~/components/auth/session-boundary'
import { sessionRedirect, useSessionStatus } from '~/components/auth/session-gate'
import { AppShell } from '~/components/shell'
import { Loading } from '~/components/states'

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
})

function ShellLayout() {
  const navigate = useNavigate()
  const { status, retry } = useSessionStatus()
  const to = sessionRedirect(status)

  // Dans un effet, et non pendant le rendu : naviguer pendant le rendu d'un composant est refusé par
  // React, et le ferait au milieu de la peinture de la coquille.
  useEffect(() => {
    if (to) void navigate({ to, replace: true })
  }, [to, navigate])

  // **La coquille ne se peint pas avant d'être méritée.** La version précédente la rendait
  // inconditionnellement : un anonyme voyait la barre et le rail apparaître puis disparaître, et —
  // plus grave — l'écran cible se montait pour un visiteur qu'on était en train d'expulser. Rien ne
  // fuit aujourd'hui, les écrans sous la coquille étant des états vides ; le jour où l'un d'eux
  // déclenche une lecture auditée au montage, l'invariant (a) ne doit pas reposer sur ce hasard.
  if (to) return <Loading label="Ouverture de la console" rows={6} />

  return (
    <SessionBoundary label="Ouverture de la console" retry={retry} rows={6} status={status}>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionBoundary>
  )
}
