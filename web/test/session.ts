import { vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'

/**
 * Le BFF que les écrans rencontrent, remplacé **à la frontière** : `fetch`. Rien du produit n'est
 * injecté — le client, le `QueryClient` et le routeur sont ceux de l'application.
 *
 * Il ne se contente pas de répondre : il **tient l'état** que le serveur tient, parce que les deux
 * seules questions qui comptent aux écrans de cette step sont des transitions. `POST /auth/login`
 * ouvre une session **non élevée** ; `POST /auth/mfa/verify` l'élève ; `POST /auth/logout` la ferme.
 * Un décor qui rendrait trois réponses indépendantes laisserait passer un écran qui n'observe jamais
 * l'élévation qu'il vient d'obtenir.
 */
export type SessionOutcome =
  | {
      readonly permissions: readonly PermissionKey[]
      /**
       * Élevée par défaut : c'est ce qu'est une session dans la coquille, puisque **toute** opération
       * gardée exige l'élévation côté serveur (`internal/bff/guard.go`). Un décor non élevé décrivait
       * un opérateur qu'aucun écran du produit ne sert.
       */
      readonly elevated?: boolean
      readonly secondFactors?: Partial<SecondFactors>
    }
  | { readonly status: number }
  | 'pending'

type SecondFactors = components['schemas']['SecondFactors']

/** Ce qu'une route d'authentification renvoie, quand le test veut autre chose que le succès. */
export type Reply = {
  readonly status: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
}

/**
 * `'pending'` : la requête **ne répond jamais**. C'est le serveur lent, seul état où l'on peut
 * observer ce qu'un écran fait pendant qu'il attend — un double-clic, un bouton qui ne s'annonce
 * pas occupé. En jsdom, une cérémonie WebAuthn échoue en une microtâche, et la fenêtre où le défaut
 * vit n'existe tout simplement pas.
 */
export type AuthReplies = {
  readonly login?: Reply | 'pending'
  readonly verify?: Reply | 'pending'
  readonly assert?: Reply | 'pending'
}

export const OPERATOR_NAME = 'Awa Kouadio'

/** Ce que `POST /auth/login` rend au succès, et que l'écran du second facteur doit reporter. */
export const CHALLENGE = 'un-challenge-de-test-assez-long-pour-passer-la-borne-de-43'

export function stubSession(outcome: SessionOutcome, replies: AuthReplies = {}) {
  let current = outcome

  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    const route = `${request.method} ${pathname}`

    switch (route) {
      case 'POST /api/auth/logout':
        current = { status: 401 }

        return new Response(null, { status: 204 })

      case 'POST /api/auth/login': {
        const reply = replies.login ?? {
          status: 200,
          body: { challenge: CHALLENGE, expiresAt: '2026-09-19T21:05:00Z' },
        }
        // Le premier facteur ouvre la session **sans** l'élever, comme le serveur : c'est ce qui
        // rend observable qu'un écran de la coquille renvoie au second facteur plutôt qu'à la
        // connexion.
        if (reply !== 'pending' && reply.status === 200) {
          current = { permissions: heldPermissions(outcome), elevated: false }
        }

        return respond(reply)
      }

      case 'POST /api/auth/mfa/verify': {
        const reply = replies.verify ?? { status: 204 }
        if (reply !== 'pending' && reply.status === 204) {
          current = { permissions: heldPermissions(outcome), elevated: true }
        }

        return respond(reply)
      }

      case 'POST /api/auth/mfa/webauthn/assert/begin':
        return respond(
          replies.assert ?? {
            status: 200,
            body: { publicKey: { challenge: 'un-defi-webauthn' } },
          },
        )

      case 'GET /api/auth/me':
        if (current === 'pending') return new Promise<Response>(() => undefined)
        if ('status' in current) {
          return Response.json(
            { code: 'test', message: 'Réponse de test.' },
            { status: current.status },
          )
        }

        return Response.json(me(current))

      default:
        throw new Error(`appel réseau non déclaré : ${route}`)
    }
  })

  vi.stubGlobal('fetch', fetch)

  return fetch
}

/**
 * Les permissions que l'opérateur détient, quel que soit l'état où le décor se trouve au moment où
 * on les lit — une session fermée puis rouverte par `POST /auth/login` retrouve les siennes.
 */
function heldPermissions(outcome: SessionOutcome): readonly PermissionKey[] {
  return typeof outcome === 'string' || 'status' in outcome ? [] : outcome.permissions
}

function respond(reply: Reply | 'pending') {
  if (reply === 'pending') return new Promise<Response>(() => undefined)

  const { status, body, headers } = reply
  if (body === undefined) return new Response(null, { headers, status })

  return Response.json(body, { headers, status })
}

function me(outcome: {
  readonly permissions: readonly PermissionKey[]
  readonly elevated?: boolean
  readonly secondFactors?: Partial<SecondFactors>
}): components['schemas']['Me'] {
  return {
    operator: {
      id: '01960000-0000-7000-8000-000000000001',
      email: 'a.kouadio@example.test',
      displayName: OPERATOR_NAME,
    },
    permissions: [...outcome.permissions],
    elevated: outcome.elevated ?? true,
    secondFactors: {
      totp: true,
      recoveryCodesRemaining: 10,
      passkeys: 0,
      ...outcome.secondFactors,
    },
    absoluteExpiresAt: '2026-09-17T20:00:00Z',
  }
}
