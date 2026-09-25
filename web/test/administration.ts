import { vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { type SessionOutcome, stubSession } from './session'

type Operator = components['schemas']['Operator']
type Role = components['schemas']['Role']

/** L'opérateur de la session, tel que `stubSession` le rend dans `GET /auth/me`. */
export const SELF_ID = '01960000-0000-7000-8000-000000000001'

export const SELF: Operator = {
  id: SELF_ID,
  email: 'a.kouadio@example.test',
  displayName: 'Awa Kouadio',
  status: 'active',
  roles: [{ id: 'role-super-admin', name: 'Propriétaire' }],
  secondFactorEnrolled: true,
  accessLink: null,
}

export const COLLEAGUE: Operator = {
  id: '01960000-0000-7000-8000-000000000002',
  email: 'm.leroy@example.test',
  displayName: 'Martin Leroy',
  status: 'active',
  roles: [],
  secondFactorEnrolled: false,
  accessLink: null,
}

export const SUPER_ADMIN: Role = {
  id: 'role-super-admin',
  name: 'Propriétaire',
  description: 'Propriétaire : toutes les permissions.',
  isDefault: true,
  permissions: ['operators:manage', 'roles:manage'],
  holders: [SELF.email],
}

export const AUDITOR: Role = {
  id: 'role-auditor',
  name: 'Audit',
  description: 'Revue conformité et sécurité.',
  isDefault: true,
  permissions: ['audit:read'],
  holders: [],
}

export const ON_CALL: Role = {
  id: 'role-astreinte',
  name: 'astreinte',
  description: 'Lecture des alertes la nuit.',
  isDefault: false,
  permissions: ['alerts:read'],
  holders: [COLLEAGUE.email],
}

type Reply = { readonly status: number; readonly body?: unknown }

/** Un refus que le test veut voir rendu, route par route. */
export type AdministrationReplies = Partial<Record<string, Reply>>

/**
 * Les routes d'administration, **à l'état près** : créer ajoute à la liste, désactiver change le
 * statut, attribuer change les rôles. Les refus structurels du serveur (auto-verrouillage, rôle par
 * défaut) ne sont pas rejoués ici — c'est `cmd/dashboard/operateurs.feature` qui les tient ; un test
 * d'écran qui veut en voir un le déclare dans `replies`, clé `« MÉTHODE /chemin »`.
 */
export function stubAdministration(
  outcome: SessionOutcome,
  initial: { operators?: Operator[]; roles?: Role[] } = {},
  replies: AdministrationReplies = {},
) {
  const session = stubSession(outcome)
  let operators = [...(initial.operators ?? [SELF, COLLEAGUE])]
  let roles = [...(initial.roles ?? [SUPER_ADMIN, AUDITOR, ON_CALL])]

  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    const route = `${request.method} ${pathname}`
    const declared = replies[route]
    if (declared !== undefined) return respond(declared)

    const [, , collection, id, detail] = pathname.split('/')
    // `POST /operators/{id}/access-link` n'a pas de corps ; `request.json()` sur un flux vide lève.
    const raw = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text()
    const body = raw ? JSON.parse(raw) : undefined

    if (collection === 'operators') {
      if (request.method === 'GET') return Response.json(operators)

      if (request.method === 'POST' && id === undefined) {
        const created: Operator = {
          id: `op-${operators.length + 1}`,
          email: body.email,
          displayName: body.displayName,
          status: 'active',
          roles: [],
          secondFactorEnrolled: false,
          accessLink: { kind: 'activation', state: 'queued' },
        }
        operators = [...operators, created]
        return Response.json(created, { status: 201 })
      }

      const target = operators.find((operator) => operator.id === id)
      if (target === undefined) return respond({ status: 404, body: refusal('not_found') })

      if (request.method === 'POST' && detail === 'access-link') {
        const sent: Operator = {
          ...target,
          accessLink: { kind: target.accessLink?.kind ?? 'reset', state: 'sent' },
        }
        operators = operators.map((operator) => (operator.id === id ? sent : operator))
        return new Response(null, { status: 202 })
      }

      let updated = target
      if (request.method === 'PATCH') updated = { ...target, status: body.status }
      if (detail === 'roles') {
        updated = {
          ...target,
          roles: roles
            .filter((role) => body.roleIds.includes(role.id))
            .map(({ id: roleId, name }) => ({ id: roleId, name })),
        }
      }

      operators = operators.map((operator) => (operator.id === id ? updated : operator))
      return Response.json(updated)
    }

    if (collection === 'roles') {
      if (request.method === 'GET') return Response.json(roles)

      if (request.method === 'POST') {
        const created: Role = {
          id: `role-${roles.length + 1}`,
          isDefault: false,
          holders: [],
          ...body,
        }
        roles = [...roles, created]
        return Response.json(created, { status: 201 })
      }

      if (request.method === 'PATCH') {
        roles = roles.map((role) => (role.id === id ? { ...role, ...body } : role))
        return Response.json(roles.find((role) => role.id === id))
      }

      roles = roles.filter((role) => role.id !== id)
      return new Response(null, { status: 204 })
    }

    return session(request)
  })

  vi.stubGlobal('fetch', fetch)

  return fetch
}

function refusal(code: string) {
  return { code, message: 'Refus de test.' }
}

function respond({ status, body }: Reply) {
  return body === undefined ? new Response(null, { status }) : Response.json(body, { status })
}
