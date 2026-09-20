import { queryOptions } from '@tanstack/react-query'
import createClient from 'openapi-fetch'
import type { components, paths } from './api.gen'

export type Me = components['schemas']['Me']

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

export function isUnauthenticated(error: unknown) {
  return error instanceof HttpError && error.status === 401
}

/**
 * Le seul client HTTP du produit, et il ne parle qu'au BFF.
 *
 * L'origine est **lue à l'exécution** : écrite dans le bundle, elle ferait rougir la garde de
 * l'invariant (d). Elle n'est pas pour autant relative — openapi-fetch construit un `Request`, que
 * Node refuse sur une URL sans origine.
 *
 * `fetch` est relu à chaque appel : openapi-fetch capture `globalThis.fetch` à la création du client,
 * et un module chargé avant le test garderait sinon le vrai.
 */
export const api = createClient<paths>({
  baseUrl: new URL('/api', window.location.href).href,
  fetch: (request) => globalThis.fetch(request),
})

/**
 * `retry: false` : un 401 ne se guérit pas en réessayant, et une panne se rend à l'opérateur, qui a
 * « Réessayer » sous la main, plutôt que d'être masquée derrière un chargement qui s'allonge.
 * `staleTime` d'une minute : le rail, la barre et chaque garde lisent la même requête ; sans lui,
 * chaque montage relirait la session. Le contrôle qui compte reste serveur, invariant (c).
 *
 * `retryOnMount: false` est ce qui rend la ligne au-dessus vraie. Sans lui, React Query relance la
 * requête au montage de tout composant qui l'observe alors qu'elle a échoué — et depuis que la garde
 * de route la lit **avant** le rendu, une panne partait donc deux fois : une pour la garde, une pour
 * la coquille qui affiche son refus. `retry: false` le disait déjà ; il ne le tenait que pour les
 * reprises d'une même tentative.
 */
export const meQueryOptions = queryOptions({
  queryKey: ['auth', 'me'],
  queryFn: async (): Promise<Me> => {
    const { data, response } = await api.GET('/auth/me')
    if (data === undefined) throw new HttpError(response.status)
    return data
  },
  retry: false,
  retryOnMount: false,
  staleTime: 60_000,
})
