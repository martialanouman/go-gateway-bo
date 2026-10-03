import { useQuery } from '@tanstack/react-query'
import { api, refusalMessage } from './api'

export const operatorsQueryKey = ['admin', 'operators'] as const
export const rolesQueryKey = ['admin', 'roles'] as const

/** Un contrôle interdit reste rendu, et porte la phrase qui dit pourquoi dans son infobulle. */
export function blockedBy(reason: string | undefined) {
  return reason === undefined ? {} : { blockedReason: reason }
}

export type FieldRefusal = { readonly field: string; readonly message: string }

/**
 * Un refus du BFF devient l'erreur de la requête, avec la phrase qu'il a rédigée et, quand il en
 * porte, les refus de champ de `errors[]`, pour qu'un formulaire les place sous leur champ.
 */
export async function orRefusal<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
  fallback: string,
): Promise<T> {
  // Une requête qui n'aboutit pas lève l'erreur réseau du navigateur, en anglais.
  const { data, error, response } = await call.catch(() => {
    throw new Error(`${fallback} : le tableau de bord ne répond pas. Réessayez dans un instant.`)
  })
  if (response.ok) return data as T
  throw Object.assign(new Error(refusalMessage(error, `${fallback} (HTTP ${response.status}).`)), {
    fields: fieldRefusals(error),
  })
}

function fieldRefusals(error: unknown): readonly FieldRefusal[] {
  if (typeof error !== 'object' || error === null || !('errors' in error)) return []
  const { errors } = error as { errors: unknown }
  return Array.isArray(errors) ? (errors as FieldRefusal[]) : []
}

/** Les refus de champ qu'une erreur de `orRefusal` porte ; aucun pour toute autre erreur. */
export function fieldRefusalsOf(error: Error | null): readonly FieldRefusal[] {
  return (error as { fields?: readonly FieldRefusal[] } | null)?.fields ?? []
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
