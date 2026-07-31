/**
 * Le rendu par permission — **un confort, jamais une garde**.
 *
 * L'invariant (c) vit côté serveur, dans `requirePermission()` (step-025). Ce qui est ici décide
 * seulement de ce qu'un opérateur *voit*, et la règle de la charte est claire : un contrôle interdit
 * est **désactivé et expliqué**, jamais silencieusement masqué. Masquer laisse l'opérateur croire
 * que la fonction n'existe pas, et le pousse à chercher un contournement ; désactiver avec sa raison
 * lui dit quoi demander.
 *
 * Le test central est donc le second : le contrôle refusé **reste dans le document**.
 */

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '~/components/primitives'
import { renderComponent } from '~/test/render'
import { PermissionGate } from './permission-gate'
import { OPERATOR_QUERY_KEY } from './use-permission'

/** Un opérateur déjà en cache : le composant ne doit pas dépendre d'un appel réseau pour rendre. */
function clientWithPermissions(permissions: readonly string[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })

  client.setQueryData(OPERATOR_QUERY_KEY, {
    id: 'op-1',
    email: 'operatrice@example.test',
    displayName: 'Opératrice',
    permissions,
    mfaCompleted: true,
  })

  return client
}

describe('PermissionGate', () => {
  it('rend l’enfant tel quel quand la permission est détenue', async () => {
    const onClick = vi.fn()
    const { getByRole, user } = renderComponent(
      <PermissionGate permission="suppressions:delete">
        <Button onClick={onClick}>Lever le désabonnement</Button>
      </PermissionGate>,
      { queryClient: clientWithPermissions(['suppressions:delete']) },
    )

    await user.click(getByRole('button', { name: 'Lever le désabonnement' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('**désactive et explique** plutôt que de masquer', async () => {
    const onClick = vi.fn()
    const { getByRole, user } = renderComponent(
      <PermissionGate permission="suppressions:delete">
        <Button onClick={onClick}>Lever le désabonnement</Button>
      </PermissionGate>,
      { queryClient: clientWithPermissions(['suppressions:read']) },
    )

    // **Le cœur de la règle** : le contrôle est toujours là. Le retirer ferait croire à l'opérateur
    // que la fonction n'existe pas, et le pousserait à chercher un contournement.
    const control = getByRole('button', { name: /Lever le désabonnement/ })
    expect(control).toBeInTheDocument()

    await user.click(control)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('nomme la permission manquante', () => {
    const { getByText } = renderComponent(
      <PermissionGate permission="suppressions:delete">
        <Button>Lever le désabonnement</Button>
      </PermissionGate>,
      { queryClient: clientWithPermissions([]) },
    )

    // La clé, verbatim : c'est ce que l'opérateur demandera à son administrateur, et ce que
    // l'administrateur cherchera dans le catalogue.
    expect(getByText(/suppressions:delete/)).toBeInTheDocument()
  })

  it('reste dans le parcours clavier, avec sa raison annoncée', async () => {
    const { getByRole, user } = renderComponent(
      <PermissionGate permission="routes:write">
        <Button>Créer une route</Button>
      </PermissionGate>,
      { queryClient: clientWithPermissions([]) },
    )

    const control = getByRole('button', { name: /Créer une route/ })

    await user.tab()
    expect(control).toHaveFocus()
    expect(control).toHaveAttribute('aria-disabled', 'true')
    // La raison est **liée**, pas seulement affichée à côté : sans cela, un lecteur d'écran annonce
    // « Créer une route, bouton, indisponible » sans jamais dire pourquoi.
    expect(control.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('masque — et seulement là — quand l’écran le demande explicitement', () => {
    // L'exception : une **entrée de navigation** vers une section entièrement inaccessible. La
    // désactiver laisserait un rail encombré d'entrées mortes, sans rien apprendre à personne. Elle
    // doit être demandée, jamais choisie par défaut.
    const { queryByRole } = renderComponent(
      <PermissionGate permission="billing:read" hideWhenDenied>
        <Button>Facturation</Button>
      </PermissionGate>,
      { queryClient: clientWithPermissions([]) },
    )

    expect(queryByRole('button')).toBeNull()
  })

  it('ne montre rien tant que les permissions ne sont pas connues', () => {
    // Rendre l'enfant actif « en attendant » le ferait clignoter d'actif à désactivé, et un
    // opérateur rapide cliquerait sur une action qu'il n'a pas.
    const empty = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { queryByRole } = renderComponent(
      <PermissionGate permission="routes:write">
        <Button>Créer une route</Button>
      </PermissionGate>,
      { queryClient: empty },
    )

    expect(queryByRole('button')).toBeNull()
  })
})
