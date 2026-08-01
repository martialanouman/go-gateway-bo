/**
 * La lecture de `/auth/me`, et les deux réponses qui ne sont pas des erreurs.
 *
 * **401 n'est pas un échec.** C'est la réponse normale d'un visiteur non connecté, et la lever
 * ferait basculer chaque écran en état d'erreur alors que la conduite à tenir est d'aller au login.
 *
 * **`undefined` n'est pas `false`.** Tant que la réponse n'est pas là, on ne sait pas — et rendre un
 * contrôle actif « en attendant » le ferait clignoter d'actif à désactivé sous le curseur d'un
 * opérateur rapide.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCurrentOperator, usePermission } from './use-permission'

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Une réponse HTTP minimale — `fetch` n'existe pas dans jsdom sans serveur. */
function respondWith(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    })),
  )
}

describe('usePermission', () => {
  it('accorde la clé que l’opérateur détient', async () => {
    respondWith(200, {
      id: 'op-1',
      email: 'operatrice@example.test',
      displayName: 'Opératrice',
      permissions: ['customers:read'],
      mfaCompleted: true,
    })

    const { result } = renderHook(() => usePermission('customers:read'), {
      wrapper: wrapper(freshClient()),
    })

    await waitFor(() => expect(result.current.granted).toBe(true))
  })

  it('refuse une clé absente de l’ensemble', async () => {
    respondWith(200, {
      id: 'op-1',
      email: 'operatrice@example.test',
      displayName: 'Opératrice',
      permissions: ['customers:read'],
      mfaCompleted: true,
    })

    const { result } = renderHook(() => usePermission('routes:write'), {
      wrapper: wrapper(freshClient()),
    })

    await waitFor(() => expect(result.current.granted).toBe(false))
  })

  it('traite 401 comme « personne », pas comme une panne', async () => {
    respondWith(401)

    const { result } = renderHook(() => usePermission('customers:read'), {
      wrapper: wrapper(freshClient()),
    })

    await waitFor(() => expect(result.current.operator).toBeNull())
    // Pas de permission, mais **pas d'erreur** : la conduite à tenir est d'aller au login.
    expect(result.current.granted).toBe(false)
  })

  it('rend `undefined` tant que la réponse n’est pas là', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )

    const { result } = renderHook(() => usePermission('customers:read'), {
      wrapper: wrapper(freshClient()),
    })

    // **Inconnu, pas refusé.** La distinction évite qu'un contrôle passe d'actif à désactivé sous
    // le curseur.
    expect(result.current.granted).toBeUndefined()
  })

  it('lève sur un vrai échec HTTP — un 500 n’est pas « personne »', async () => {
    // **Ce test était mort.** Il attendait `granted === undefined`, ce qui est déjà vrai au premier
    // rendu, avant tout appel : `waitFor` passait immédiatement, et remplacer la levée par un
    // `return null` le laissait vert. Il faut donc observer l'état de la requête, pas la valeur
    // dérivée — la distinction entre « pas connecté » et « la passerelle est tombée » compte, la
    // première envoie au login et la seconde à un état d'erreur.
    respondWith(500)

    const { result } = renderHook(() => useCurrentOperator(), {
      wrapper: wrapper(freshClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it('distingue 401 de 500 — l’un n’est pas une panne, l’autre si', async () => {
    respondWith(401)

    const { result } = renderHook(() => useCurrentOperator(), {
      wrapper: wrapper(freshClient()),
    })

    await waitFor(() => expect(result.current.data).toBeNull())
    expect(result.current.isError).toBe(false)
  })
})
