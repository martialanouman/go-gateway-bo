import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { EmptyState, ErrorState, LoadingState, Skeleton, ToastStack } from '~/components/ui'
import { HttpError, isUnauthenticated, meQueryOptions } from '~/lib/api'
import { Rail } from './rail'

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
                L’écran de connexion n’est pas encore livré ; il arrive avec step-027, au jalon M1.
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
      <ToastStack>
        <Frame rail={<Rail />}>{children}</Frame>
      </ToastStack>
    )
  }

  if (me.error !== null) {
    const status = me.error instanceof HttpError ? String(me.error.status) : 'réseau'
    return (
      <Frame>
        <ErrorState
          description="Le tableau de bord n’a pas pu vérifier la session ; aucun écran ne s’ouvre sans elle."
          onRetry={() => void me.refetch()}
          request={`GET /api/auth/me · ${status}`}
          // Le titre par défaut accuse l'API Admin ; c'est le BFF qui répond à `/auth/me`.
          title="Impossible de vérifier la session"
          titleAs="h1"
        />
      </Frame>
    )
  }

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
    <div className="shell">
      {/* biome-ignore lint/a11y/useValidAnchor: `#contenu` est une vraie destination ; le clic ne fait qu'y porter le focus. */}
      <a
        className="shell__skip"
        href="#contenu"
        onClick={(event) => {
          // Le fragment seul ne suffit pas : le routeur réécrirait l'URL, et `main` ne prend le focus
          // que si on le lui donne.
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
  )
}
