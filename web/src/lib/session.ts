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
 * Efface ce que le client croit savoir de la session, après l'avoir changée.
 *
 * Sans cet oubli, la connexion réussie n'ouvrait rien : la garde du second facteur relisait le
 * **401 mis en cache** avant elle, concluait « aucune session » et renvoyait au formulaire. Un
 * `invalidateQueries` suffirait à le faire refetcher ; `removeQueries` dit ce qui s'est passé — ce
 * qui était connu ne vaut plus, y compris l'échec.
 */
export function forgetSession(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: meQueryOptions.queryKey })
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
  // Un blanc ou une contre-oblique **ailleurs** dans la valeur : `/\n//ailleurs.example` ne
  // commence ni par `//` ni par `/\`, et traversait donc les deux lignes au-dessus. Ce n'est pas
  // une redirection ouverte aujourd'hui — le routeur ne garde que le chemin de l'URL qu'il
  // construit, mesuré — mais le plafond est alors **chez lui** et non ici. Le jour où cette valeur
  // alimente un `<a href>`, un rechargement de document ou une redirection serveur, elle redevient
  // un hameçon. Cette fonction promet une adresse de ce tableau de bord ; elle le tient seule.
  if (/[\s\\]/.test(raw)) return undefined

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
