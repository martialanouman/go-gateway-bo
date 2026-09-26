import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Me } from './api'
import { meQueryOptions } from './api'
import { grants, PermissionGate } from './permissions'

/**
 * La garde seule, sur une session posée dans le cache. Le chemin produit — provider monté par le
 * routeur, session lue sur le réseau — est traversé par `components/shell.test.tsx`, qui passe par
 * `createAppRouter`. Ici, seule la décision est en jeu.
 */
function renderGate(permissions: readonly string[] | undefined) {
  const client = new QueryClient()
  if (permissions !== undefined) {
    client.setQueryData(meQueryOptions.queryKey, { permissions } as Me)
  }
  render(
    <QueryClientProvider client={client}>
      <PermissionGate fallback={<p>Refusé</p>} permission="billing:topup">
        <p>Recharger</p>
      </PermissionGate>
    </QueryClientProvider>,
  )
}

describe('PermissionGate', () => {
  it('renders the fallback when the session does not hold the key', () => {
    renderGate(['billing:read'])
    expect(screen.queryByText('Recharger')).toBeNull()
    expect(screen.getByText('Refusé')).toBeInTheDocument()
  })

  it('renders its content when the session holds the key', () => {
    renderGate(['billing:read', 'billing:topup'])
    expect(screen.getByText('Recharger')).toBeInTheDocument()
  })

  it('denies while the session is unknown', () => {
    renderGate(undefined)
    expect(screen.queryByText('Recharger')).toBeNull()
  })
})

describe('grants', () => {
  it('requires nothing of an entry without a key, provided a session exists', () => {
    expect(grants([], [])).toBe(true)
    expect(grants(undefined, [])).toBe(false)
  })

  it('is satisfied by any one of the requested keys', () => {
    expect(grants(['gdpr:erase'], ['content:read', 'gdpr:erase'])).toBe(true)
    expect(grants(['content:erase'], ['gdpr:erase'])).toBe(false)
  })
})
