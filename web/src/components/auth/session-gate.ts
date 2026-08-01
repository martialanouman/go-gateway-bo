/**
 * L'état de session, et ce qu'un écran gardé doit en faire.
 *
 * ## Cinq états, pas deux
 *
 * La première version ne distinguait que « connu » et « pas encore connu », et cela a produit deux
 * défauts symétriques. Une requête `/auth/me` **en erreur** a `isPending: false` et `data:
 * undefined` : elle passait donc pour « aucune session ». La coquille n'en tirait aucune
 * redirection et restait vide indéfiniment ; l'écran de vérification, lui, renvoyait au login — d'où
 * un va-et-vient entre les deux écrans à chaque hoquet du serveur, chaque tour consommant une
 * tentative du compteur anti-brute-force, pour une panne dont l'opérateur n'est pas responsable.
 *
 * `unknown` (on attend) et `unavailable` (on ne saura pas) demandent deux conduites différentes :
 * la première un squelette, la seconde un état d'erreur avec « Réessayer ». Aucune des deux n'est
 * une redirection.
 *
 * ## Une règle, appliquée partout
 *
 * Trois écrans gardent une session — la coquille, la racine, le second facteur — et rien ne les
 * empêchait d'en donner trois lectures. C'est arrivé. La classification est ici, et elle est pure :
 * elle se teste sans routeur, ce qui est la seule façon de couvrir les cas qui n'arrivent qu'en
 * production.
 */

import type { CurrentOperator } from '~/components/permission'
import { useCurrentOperator } from '~/components/permission'

export type SessionStatus =
  /** La réponse n'est pas encore là. Ne rien décider — un squelette. */
  | 'unknown'
  /** `/auth/me` a échoué. Ne **pas** déconnecter : un 502 passager ne vaut pas une expulsion. */
  | 'unavailable'
  /** Aucune session. */
  | 'anonymous'
  /** Mot de passe passé, second facteur non franchi. Aucune permission. */
  | 'partial'
  | 'complete'

export type SessionQuery = {
  readonly data: CurrentOperator | null | undefined
  readonly isError: boolean
}

export function sessionStatus({ data, isError }: SessionQuery): SessionStatus {
  // **Une session connue survit à une panne ; un `null` en cache, non.**
  //
  // Ces deux moitiés ont chacune coûté un défaut. Regarder `isError` en premier jetait une session
  // parfaitement connue au premier rafraîchissement raté — TanStack Query conserve `data` et passe
  // en `error` — et peignait une panne par-dessus une console qui marchait.
  //
  // Mais faire primer la donnée **quelle qu'elle soit** rouvrait la boucle qu'on croyait fermée. Le
  // `null` en cache n'est pas une observation de plus : c'est celui que la garde vient d'écrire en
  // renvoyant au login. Après un mot de passe accepté, si la relecture échoue, ce `null` est
  // **périmé** — la session existe désormais — et le lire comme « anonyme » renvoyait l'opérateur au
  // formulaire qu'il venait de remplir, en boucle tant que le serveur tombait.
  //
  // Un opérateur, lui, est une observation positive : elle vaut mieux qu'un aveu d'ignorance.
  if (isError && !data) return 'unavailable'

  if (data === undefined) return 'unknown'
  if (data === null) return 'anonymous'

  return data.mfaCompleted ? 'complete' : 'partial'
}

export type SessionGate = {
  readonly status: SessionStatus
  /**
   * Refait la requête. C'est ce que « Réessayer » doit faire — pas recharger la page : un
   * rechargement jette le cache, les toasts en cours et la position de défilement pour reposer la
   * seule question à laquelle il fallait répondre.
   */
  readonly retry: () => void
}

/** L'état de la session courante, pour un écran. Une seule requête, partagée par tous. */
export function useSessionStatus(): SessionGate {
  const { data, isError, refetch } = useCurrentOperator()

  return {
    status: sessionStatus({ data, isError }),
    retry: () => {
      void refetch()
    },
  }
}

export type SessionRedirect = '/connexion' | '/connexion/verification' | undefined

/**
 * Où renvoyer, pour un écran qui exige une session **complète**.
 *
 * `unknown` et `unavailable` ne renvoient nulle part : rediriger pendant l'attente sortirait de la
 * console un opérateur légitime à chaque rechargement, et rediriger sur une panne le ferait à chaque
 * hoquet du serveur. L'écran appelant doit peindre ces deux états, pas naviguer.
 */
export function sessionRedirect(status: SessionStatus): SessionRedirect {
  if (status === 'anonymous') return '/connexion'
  if (status === 'partial') return '/connexion/verification'

  return undefined
}
