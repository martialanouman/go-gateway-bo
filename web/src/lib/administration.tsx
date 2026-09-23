import { useQuery } from '@tanstack/react-query'
import { api, refusalMessage } from './api'

export const operatorsQueryKey = ['admin', 'operators'] as const
export const rolesQueryKey = ['admin', 'roles'] as const

/** Un contrôle interdit reste rendu, et se relie à la phrase qui dit pourquoi. */
export function blockedBy(reasonId: string | undefined) {
  return reasonId === undefined
    ? { blocked: false as const }
    : { blocked: true as const, 'aria-describedby': reasonId }
}

/** Un refus du BFF devient l'erreur de la requête, avec la phrase qu'il a rédigée. */
export async function orRefusal<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
  fallback: string,
): Promise<T> {
  const { data, error, response } = await call
  if (response.ok) return data as T
  throw new Error(refusalMessage(error, `${fallback} (HTTP ${response.status}).`))
}

export function useRoles(enabled: boolean) {
  return useQuery({
    queryKey: rolesQueryKey,
    queryFn: () => orRefusal(api.GET('/roles'), 'La liste des rôles n’a pas pu être lue'),
    enabled,
    retry: false,
  })
}

export function Refusal({ error }: { readonly error: Error | null }) {
  return error === null ? null : (
    <p className="form-refusal" role="alert">
      {error.message}
    </p>
  )
}
