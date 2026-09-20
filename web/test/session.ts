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
  /**
   * Le serveur rend 204 même sans session — se déconnecter est une demande d'**état**, et l'état est
   * atteint. Mais il peut tomber, et c'est le seul cas où l'on peut observer qu'une sortie reste une
   * sortie : sans cette clé, un écran qui ne repartirait que sur un succès passait vert.
   */
  readonly logout?: Reply | 'pending'
  readonly enroll?: Reply | 'pending'
  readonly register?: Reply | 'pending'
  readonly registered?: Reply | 'pending'
}

export const OPERATOR_NAME = 'Awa Kouadio'

/** Ce que `POST /auth/login` rend au succès, et que l'écran du second facteur doit reporter. */
export const CHALLENGE = 'un-challenge-de-test-assez-long-pour-passer-la-borne-de-43'

/**
 * Ce que `POST /auth/mfa/totp/enroll` rend au succès, et que l'écran d'enrôlement montre **une
 * seule fois**.
 *
 * Le secret est le même dans l'URI et dans le champ `secret`, comme le contrat l'exige : deux
 * valeurs différentes feraient qu'une des deux voies d'enrôlement marcherait et pas l'autre.
 */
export const ENROLLMENT_SECRET = 'JBSWY3DPEHPK3PXP'

export const OTPAUTH_URI = `otpauth://totp/SMS%20Gateway:a.kouadio%40example.test?secret=${ENROLLMENT_SECRET}&issuer=SMS%20Gateway&algorithm=SHA1&digits=6&period=30`

export const RECOVERY_CODES = [
  'a1b2c-3d4e5',
  'f6g7h-8i9j0',
  'k1l2m-3n4o5',
  'p6q7r-8s9t0',
  'u1v2w-3x4y5',
  'z6a7b-8c9d0',
  'e1f2g-3h4i5',
  'j6k7l-8m9n0',
  'o1p2q-3r4s5',
  't6u7v-8w9x0',
]

export function stubSession(outcome: SessionOutcome, replies: AuthReplies = {}) {
  let current = outcome
  /**
   * Ce que l'enrôlement vient de poser sur le compte, par-dessus ce que le test a déclaré.
   *
   * Le serveur le tient, donc le décor aussi : sans cette couche, l'écran d'enrôlement enrôlerait
   * un facteur que `GET /auth/me` continuerait d'annoncer absent, et la vérification qui suit
   * relirait « ce compte n'a rien » — l'enchaînement même que la step livre ne serait jamais
   * observable.
   */
  let granted: Partial<SecondFactors> = {}

  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    const route = `${request.method} ${pathname}`

    switch (route) {
      case 'POST /api/auth/logout': {
        const reply = replies.logout ?? { status: 204 }
        // La session ne tombe que si le serveur a bien fermé : un échec laisse le cookie vivant.
        if (reply !== 'pending' && reply.status < 400) current = { status: 401 }

        return respond(reply)
      }

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

      case 'POST /api/auth/mfa/totp/enroll': {
        const reply = replies.enroll ?? {
          status: 200,
          body: {
            secret: ENROLLMENT_SECRET,
            otpauthUri: OTPAUTH_URI,
            recoveryCodes: RECOVERY_CODES,
          },
        }
        // L'enrôlement **n'élève pas** la session — c'est `POST /auth/mfa/verify` qui le fait, avec
        // le premier code. Il pose seulement le facteur.
        if (reply !== 'pending' && reply.status === 200) {
          granted = { ...granted, totp: true, recoveryCodesRemaining: RECOVERY_CODES.length }
        }

        return respond(reply)
      }

      case 'POST /api/auth/mfa/webauthn/register/begin':
        return respond(
          replies.register ?? {
            status: 200,
            body: {
              publicKey: {
                rp: { id: 'exemple.test', name: 'SMS Gateway' },
                user: {
                  id: 'dW4tb3BlcmF0ZXVy',
                  name: 'a.kouadio@example.test',
                  displayName: 'Awa',
                },
                challenge: 'un-defi-d-enregistrement',
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
              },
            },
          },
        )

      case 'POST /api/auth/mfa/webauthn/register/finish': {
        const reply = replies.registered ?? { status: 200, body: { id: 'une-passkey' } }
        if (reply !== 'pending' && reply.status === 200) {
          granted = { ...granted, passkeys: heldPasskeys(outcome) + 1 }
        }

        return respond(reply)
      }

      case 'GET /api/auth/me':
        if (current === 'pending') return new Promise<Response>(() => undefined)
        if ('status' in current) {
          return Response.json(
            { code: 'test', message: 'Réponse de test.' },
            { status: current.status },
          )
        }

        return Response.json(
          me({ ...current, secondFactors: { ...current.secondFactors, ...granted } }),
        )

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

/** Les clés d'accès déjà détenues, dont l'enregistrement d'une nouvelle part. */
function heldPasskeys(outcome: SessionOutcome): number {
  if (typeof outcome === 'string' || 'status' in outcome) return 0

  return outcome.secondFactors?.passkeys ?? 0
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
