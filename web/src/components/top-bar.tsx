import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '~/components/ui'
import { api, type Me, meQueryOptions } from '~/lib/api'

/**
 * Le nom d'affichage, **sans rôle**, contrairement au `TopBar` de la charte. Le contrat de
 * `/auth/me` n'en rend aucun, et il dit pourquoi : une liste de rôles au navigateur invite à
 * réintroduire le contrôle de rôle côté client (`api/openapi-bff.yaml`, opération `me`).
 *
 * La déconnexion relit la session **qu'elle ait réussi ou non** : c'est le serveur qui dit si elle
 * vit encore, pas l'issue de la requête.
 */
export function TopBar({ operator }: { readonly operator: Me['operator'] }) {
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: () => api.POST('/auth/logout'),
    onSettled: () => queryClient.resetQueries({ queryKey: meQueryOptions.queryKey }),
  })

  return (
    <div className="topbar__end">
      <span className="topbar__operator">{operator.displayName}</span>
      <Button loading={logout.isPending} onClick={() => logout.mutate()} size="sm">
        Se déconnecter
      </Button>
    </div>
  )
}
