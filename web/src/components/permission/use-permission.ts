/**
 * L'ensemble de permissions de l'opérateur courant, côté client.
 *
 * ## Pour le rendu, jamais pour l'autorisation
 *
 * C'est l'invariant (c), et la seule chose à retenir de ce module. Ce que `/auth/me` rend ici sert à
 * décider quels contrôles apparaissent — pas à décider si une action aboutit. Chaque fonction
 * serveur revérifie ses propres permissions (`requirePermission`, step-025), et un contrôle masqué
 * dont la route n'est pas gardée reste une faille.
 *
 * ## Une seule requête, partagée
 *
 * La clé de cache est constante, si bien que trente `PermissionGate` sur un écran partagent une
 * réponse. Sans cela, le rail de navigation à lui seul déclencherait une requête par entrée.
 */

import { useQuery } from '@tanstack/react-query'
import type { PermissionKey } from '~/lib/permissions'

/** Constante et exportée : les tests amorcent le cache dessus plutôt que d'intercepter le réseau. */
export const OPERATOR_QUERY_KEY = ['auth', 'me'] as const

export type CurrentOperator = {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly permissions: readonly PermissionKey[]
  readonly mfaCompleted: boolean
}

export async function fetchCurrentOperator(): Promise<CurrentOperator | null> {
  const response = await fetch('/api/auth/me', { headers: { accept: 'application/json' } })

  // 401 n'est pas une erreur ici : c'est la réponse normale d'un visiteur non connecté. La lever
  // ferait basculer chaque écran en état d'erreur alors qu'il faut aller au login (step-026).
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`GET /api/auth/me — ${response.status}`)

  return (await response.json()) as CurrentOperator
}

/**
 * La requête, en un seul endroit.
 *
 * Le hook la consomme, et le `beforeLoad` de la coquille l'attend par `ensureQueryData` : deux
 * définitions séparées auraient fini par diverger sur la clé de cache, et la garde aurait alors
 * interrogé le serveur pour un résultat que l'écran n'aurait jamais lu.
 */
export function operatorQueryOptions() {
  return { queryKey: OPERATOR_QUERY_KEY, queryFn: fetchCurrentOperator }
}

export function useCurrentOperator() {
  return useQuery(operatorQueryOptions())
}

export type PermissionState = {
  /** `undefined` tant que l'ensemble n'est pas connu — à distinguer de « refusé ». */
  readonly granted: boolean | undefined
  readonly operator: CurrentOperator | null | undefined
}

/**
 * Dit si l'opérateur détient une clé.
 *
 * Rend `undefined` tant que la réponse n'est pas là. Le distinguer de `false` n'est pas une
 * subtilité : rendre un contrôle **actif** en attendant le ferait clignoter d'actif à désactivé, et
 * un opérateur rapide cliquerait sur une action qu'il n'a pas.
 */
export function usePermission(permission: PermissionKey): PermissionState {
  const { data } = useCurrentOperator()

  return {
    granted: data === undefined ? undefined : (data?.permissions.includes(permission) ?? false),
    operator: data,
  }
}
