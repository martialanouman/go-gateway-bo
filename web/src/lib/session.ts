import type { QueryClient } from '@tanstack/react-query'
import { isUnauthenticated, type Me, meQueryOptions } from './api'

/**
 * Trois états et non deux, parce que « pas de session » et « je ne sais pas » appellent des gestes
 * opposés. Une panne du BFF lue comme une absence de session renverrait l'opérateur se reconnecter
 * avec un cookie intact, et la connexion échouerait sur la même panne — invariant (e) : le tableau
 * de bord dégrade, il ne déconnecte pas.
 */
export type SessionState =
  | { readonly kind: 'open'; readonly me: Me }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' }

/**
 * La session telle que les gardes de route la lisent, par le cache que les écrans partagent :
 * `meQueryOptions` est la même requête que la coquille, le rail et `usePermission` consomment, donc
 * la garde ne relit pas le BFF pour son propre compte.
 */
export async function readSession(queryClient: QueryClient): Promise<SessionState> {
  try {
    return { kind: 'open', me: await queryClient.ensureQueryData(meQueryOptions) }
  } catch (error) {
    return isUnauthenticated(error) ? { kind: 'none' } : { kind: 'unknown' }
  }
}

/**
 * La destination rejouée après la connexion, ramenée à une adresse de ce tableau de bord — ou
 * `undefined`, qui vaut l'accueil.
 *
 * Sans cette réduction, `?redirect=//ailleurs.example` ferait du paramètre un hameçon : le lien
 * porte le domaine du cockpit, l'opérateur s'y connecte, et la redirection le dépose ailleurs avec
 * la connexion encore en tête. `//` et `/\` sont deux écritures de la même URL de schéma relatif, et
 * les navigateurs suivent les deux.
 */
export function safeDestination(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return undefined
  if (raw.startsWith('//') || raw.startsWith('/\\')) return undefined

  return raw
}

/**
 * Le challenge rendu par `POST /auth/login`, entre l'écran de connexion et celui du second facteur.
 *
 * Il vit **en mémoire du document**, et nulle part ailleurs. L'URL est exclue par la fiche comme par
 * la charte — elle se recopie, s'historise et part dans un `Referer`. Le stockage local l'est pour
 * une raison de plus : il **survit** à la fermeture de l'onglet, alors que le challenge, lui, ne vaut
 * que cinq minutes.
 *
 * La conséquence est voulue : recharger l'écran du second facteur perd le challenge, et la garde
 * renvoie à la connexion plutôt que de laisser un formulaire dont chaque envoi serait refusé.
 */
let pendingChallenge: string | undefined

export function rememberChallenge(value: string) {
  pendingChallenge = value
}

export function peekChallenge() {
  return pendingChallenge
}

export function forgetChallenge() {
  pendingChallenge = undefined
}
