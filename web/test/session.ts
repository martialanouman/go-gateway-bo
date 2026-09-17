import { vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'

/**
 * La session que le BFF rendrait, remplacée **à la frontière** : `fetch`. Rien du produit n'est
 * injecté — le client, le `QueryClient` et le routeur sont ceux de l'application.
 *
 * `POST /api/auth/logout` ferme la session : l'appel suivant à `/auth/me` rend 401, comme le serveur.
 */
export type SessionOutcome =
  | { readonly permissions: readonly PermissionKey[] }
  | { readonly status: number }
  | 'pending'

export const OPERATOR_NAME = 'Awa Kouadio'

export function stubSession(outcome: SessionOutcome) {
  let current = outcome
  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      current = { status: 401 }
      return new Response(null, { status: 204 })
    }

    if (request.method === 'GET' && pathname === '/api/auth/me') {
      if (current === 'pending') return new Promise<Response>(() => undefined)
      if ('status' in current) {
        return Response.json(
          { code: 'test', message: 'Réponse de test.' },
          { status: current.status },
        )
      }
      return Response.json(me(current.permissions))
    }

    throw new Error(`appel réseau non déclaré : ${request.method} ${pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function me(permissions: readonly PermissionKey[]): components['schemas']['Me'] {
  return {
    operator: {
      id: '01960000-0000-7000-8000-000000000001',
      email: 'a.kouadio@example.test',
      displayName: OPERATOR_NAME,
    },
    permissions: [...permissions],
    elevated: false,
    secondFactors: { totp: false, recoveryCodesRemaining: 0, passkeys: 0 },
    absoluteExpiresAt: '2026-09-17T20:00:00Z',
  }
}
