import { useQuery } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingState, Skeleton, ToastStack } from '~/components/ui'
import { HttpError, isUnauthenticated, meQueryOptions } from '~/lib/api'
import { Rail } from './rail'
import { TopBar } from './top-bar'

/**
 * La silhouette seule, pendant que la **garde de route** lit la session.
 *
 * Elle existe parce que la garde attend : `beforeLoad` ne rend rien tant qu'il n'a pas décidé, si
 * bien que l'état de chargement ci-dessous n'est plus atteignable par un écran gardé. Sans ce
 * composant, le squelette peint par `index.html` cédait la place à un écran **vide** le temps d'un
 * aller-retour — exactement le blanc que le §1.9 interdit.
 */
export function ShellPending() {
  return (
    <Frame>
      <LoadingState label="Ouverture de la session">
        <Skeleton width={240} />
        <Skeleton width={180} />
      </LoadingState>
    </Frame>
  )
}

/**
 * La coquille reprend la silhouette que `index.html` a peinte — rail, barre supérieure, contenu —
 * pour que le passage du squelette à React ne déplace rien à l'écran. Elle lit la session : sans
 * elle, aucun écran ne s'ouvre.
 *
 * **Pourquoi un composant et non la mise en page elle-même.** Deux routes la rendent : `_shell`, qui
 * enveloppe les écrans, et le `notFoundComponent` de la racine — une URL inconnue ne matche aucun
 * enfant de `_shell`, donc son message est rendu *hors* de la mise en page. Sans cette extraction, la
 * garde « une adresse inconnue garde la coquille autour du message » deviendrait fausse ou
 * disparaîtrait, alors qu'elle décrit un comportement voulu : l'opérateur doit pouvoir repartir d'où
 * il est.
 */
export function Shell({ children }: { readonly children: ReactNode }) {
  const me = useQuery(meQueryOptions)
  const router = useRouter()

  if (isUnauthenticated(me.error)) {
    return (
      <Frame>
        <EmptyState
          description={
            <>
              <p>
                Le tableau de bord ne montre aucun écran sans session : la navigation et les données
                restent fermées.
              </p>
              <p>
                {/* Sans destination à rejouer : l'adresse d'où l'on vient ne correspond à aucun
                    écran, et y revenir ramènerait à ce même message. */}
                <Link search={{ passwordSet: false, redirect: undefined }} to="/login">
                  Se connecter
                </Link>{' '}
                ouvre une session et conduit à l’accueil.
              </p>
            </>
          }
          title="Aucune session ouverte"
          titleAs="h1"
        />
      </Frame>
    )
  }

  // Une session déjà lue reste affichée si une relecture échoue : la panne dégrade, elle ne vide pas
  // l'écran (invariant e).
  if (me.data !== undefined) {
    return (
      <Frame rail={<Rail />} topbar={<TopBar operator={me.data.operator} />}>
        {children}
      </Frame>
    )
  }

  if (me.error !== null) {
    const status = me.error instanceof HttpError ? String(me.error.status) : 'réseau'
    return (
      <Frame>
        <ErrorState
          description="Le tableau de bord n’a pas pu vérifier la session ; aucun écran ne s’ouvre sans elle."
          // `router.invalidate()` et non `me.refetch()` : ce qu'il faut rejouer est la **garde**,
          // pas la seule requête. Une relecture réussie peut rendre une session **non élevée**, et
          // la coquille se peignait alors tout entière — `beforeLoad` ne se rejoue pas de lui-même
          // — pour un cockpit dont chaque appel gardé rendrait 403. La garde, elle, tranche.
          onRetry={() => void router.invalidate()}
          request={`GET /api/auth/me · ${status}`}
          // Le titre par défaut accuse l'API Admin ; c'est le BFF qui répond à `/auth/me`.
          title="Impossible de vérifier la session"
          titleAs="h1"
        />
      </Frame>
    )
  }

  // Atteignable par une adresse inconnue, qui rend la coquille **hors** de la garde. La même
  // silhouette que l'attente de la garde : deux rédactions divergeraient.
  return <ShellPending />
}

/**
 * La silhouette qu'`index.html` a peinte, quel que soit l'état : le passage du squelette à React ne
 * déplace rien. Sans session, le rail reste une surface vide — une navigation dont chaque lien
 * mènerait à un refus serait un lien mort.
 */
function Frame({
  rail,
  topbar,
  children,
}: {
  readonly rail?: ReactNode
  readonly topbar?: ReactNode
  readonly children: ReactNode
}) {
  return (
    // La pile de toasts enveloppe **tous** les états : montée dans la seule branche de session, elle
    // change la forme de l'arbre à l'arrivée de la session, et React remonte le cadre entier.
    <ToastStack>
      <div className="shell">
        {/* biome-ignore lint/a11y/useValidAnchor: `#contenu` est une vraie destination ; le clic ne fait qu'y porter le focus. */}
        <a
          className="shell__skip"
          href="#contenu"
          onClick={(event) => {
            // Le fragment seul ne déplace pas le focus : `main` ne le prend que si on le lui donne, et le
            // test du lien d'évitement rougit sans `focus()`. `preventDefault` garde `#contenu` hors de
            // l'adresse ; aucun test ne rougit s'il disparaît — l'historique en mémoire du test ne voit
            // pas le fragment.
            event.preventDefault()
            document.getElementById('contenu')?.focus()
          }}
        >
          Aller au contenu
        </a>
        {rail ?? <div className="shell__rail" />}
        <header className="shell__topbar">{topbar}</header>
        <main className="shell__content" id="contenu" tabIndex={-1}>
          {children}
        </main>
      </div>
    </ToastStack>
  )
}
