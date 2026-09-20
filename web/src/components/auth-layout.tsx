import type { ReactNode } from 'react'
import { Icon, LoadingState, Skeleton } from '~/components/ui'

/**
 * La mise en page des deux écrans qui précèdent la session : connexion et second facteur.
 *
 * **Elle n'est pas la coquille, et c'est tout son objet.** Ni rail ni barre supérieure — leurs
 * entrées mèneraient toutes à un refus —, donc pas non plus de lien d'évitement : il n'y a rien à
 * éviter. Le `main` porte quand même son `id`, pour que la page ait un repère de contenu comme
 * partout ailleurs.
 */
export function AuthLayout({
  title,
  intro,
  children,
}: {
  readonly title: ReactNode
  /** Ce que l'écran demande et pourquoi, sous le titre. */
  readonly intro?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="auth">
      <main className="auth__card" id="contenu">
        <p className="auth__brand">SMS Gateway</p>
        <h1 className="auth__title">{title}</h1>
        {intro === undefined ? null : <p className="auth__intro">{intro}</p>}
        {children}
      </main>
    </div>
  )
}

/**
 * L'attente pendant que la garde lit la session, avant que l'écran ne sache quoi demander.
 *
 * Un squelette de la **vraie** mise en page et non un libellé seul (§1.9) : deux champs et leur
 * bouton, à la place qu'ils occuperont. Sans cela, la carte se remplit d'un coup et déplace tout ce
 * que l'œil venait de fixer.
 *
 * Le titre est celui de l'écran visé : la garde ne change pas ce que l'écran demande, seulement
 * s'il a le droit de le demander.
 */
export function AuthPending({ title }: { readonly title: ReactNode }) {
  return (
    <AuthLayout title={title}>
      <LoadingState label="Vérification de la session en cours">
        <Skeleton height={34} />
        <Skeleton height={34} />
        <Skeleton height={34} width={140} />
      </LoadingState>
    </AuthLayout>
  )
}

/**
 * Le refus que le serveur vient de rendre, au-dessus du formulaire qui l'a reçu.
 *
 * Ce n'est pas un `ErrorState` : celui-là promet « vos données locales restent affichées », ce qui
 * n'a aucun sens devant un écran qui n'a encore rien ouvert, et offre un « Réessayer » alors que la
 * reprise passe par le formulaire lui-même.
 *
 * `role="alert"` parce que le refus arrive **après** une réponse du serveur, sans que le focus ait
 * bougé : sans lui, le message apparaît dans un élément inerte que les lecteurs d'écran ne relisent
 * pas. WCAG 2.1 AA, 4.1.3 — le même arbitrage que `Field`.
 */
export function AuthRefusal({ children }: { readonly children: ReactNode }) {
  return (
    <p className="auth__refusal" role="alert">
      <Icon name="bang" size={13} />
      <span>{children}</span>
    </p>
  )
}
