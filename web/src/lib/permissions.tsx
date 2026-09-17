import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { meQueryOptions } from './api'
import type { PermissionKey } from './permissions.gen'

/**
 * Ce que la session ouvre, lu dans `/auth/me` — jamais un rôle. Tout ce qui en dépend est un
 * **confort** : la garde est serveur, invariant (c). Sans session connue, tout est refusé.
 */
export function grants(held: readonly string[] | undefined, anyOf: readonly PermissionKey[]) {
  if (held === undefined) return false
  return anyOf.length === 0 || anyOf.some((key) => held.includes(key))
}

export function usePermissions() {
  const { data } = useQuery(meQueryOptions)
  return (anyOf: readonly PermissionKey[]) => grants(data?.permissions, anyOf)
}

export function usePermission(key: PermissionKey) {
  return usePermissions()([key])
}

/**
 * Le repli est à la charge de l'appelant, et il n'est pas facultatif en pratique : un contrôle
 * interdit se montre désactivé et expliqué, jamais escamoté.
 */
export function PermissionGate({
  permission,
  fallback = null,
  children,
}: {
  readonly permission: PermissionKey
  readonly fallback?: ReactNode
  readonly children: ReactNode
}) {
  return usePermission(permission) ? children : fallback
}
