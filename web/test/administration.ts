import { vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { type SessionOutcome, stubSession } from './session'

type Operator = components['schemas']['Operator']
type Role = components['schemas']['Role']
type Group = components['schemas']['CustomerGroup']
type Customer = components['schemas']['Customer']

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

export const RESELLERS: Group = {
  id: '0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b',
  name: 'Revendeurs',
  description: 'Clients revendus par un partenaire.',
  status: 'active',
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
}

export const ACME: Customer = {
  id: '0192b3c4-0000-7000-8000-00000000c001',
  name: 'Acme Télécom',
  status: 'active',
  groupId: '0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b',
  createdAt: '2026-09-02T08:00:00Z',
  updatedAt: '2026-09-02T08:00:00Z',
}

type Reply = { readonly status: number; readonly body?: unknown }

/** Un refus que le test veut voir rendu, route par route. */
export type AdministrationReplies = Partial<Record<string, Reply>>

/**
 * Les routes d'administration, **à l'état près** : créer ajoute à la liste, désactiver change le
 * statut, attribuer change les rôles. Les refus structurels du serveur (auto-verrouillage, rôle par
 * défaut) ne sont pas rejoués ici — c'est `cmd/dashboard/operators.feature` qui les tient ; un test
 * d'écran qui veut en voir un le déclare dans `replies`, clé `« MÉTHODE /chemin »`.
 */
export function stubAdministration(
  outcome: SessionOutcome,
  initial: {
    operators?: Operator[]
    roles?: Role[]
    groups?: Group[]
    customers?: Customer[]
    customerPageSize?: number
  } = {},
  replies: AdministrationReplies = {},
) {
  const session = stubSession(outcome)
  let operators = [...(initial.operators ?? [SELF, COLLEAGUE])]
  let roles = [...(initial.roles ?? [SUPER_ADMIN, AUDITOR, ON_CALL])]
  let groups = [...(initial.groups ?? [RESELLERS])]
  let customers = [...(initial.customers ?? [ACME])]
  const customerPageSize = initial.customerPageSize ?? 50

  const fetch = vi.fn(async (request: Request) => {
    const { pathname, searchParams } = new URL(request.url)
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

    if (collection === 'customers') {
      if (request.method === 'POST') {
        const created: Customer = {
          id: `customer-${customers.length + 1}`,
          status: 'active',
          createdAt: '2026-09-29T08:00:00Z',
          updatedAt: '2026-09-29T08:00:00Z',
          ...body,
        }
        customers = [...customers, created]
        return Response.json(created, { status: 201 })
      }

      const matching = customers.filter(
        (customer) =>
          (searchParams.get('status') === null || customer.status === searchParams.get('status')) &&
          (searchParams.get('groupId') === null ||
            customer.groupId === searchParams.get('groupId')),
      )
      const start = Number(searchParams.get('cursor') ?? 0)
      const end = start + customerPageSize
      return Response.json({
        items: matching.slice(start, end),
        ...(end < matching.length ? { nextCursor: String(end) } : {}),
      })
    }

    if (collection === 'customer-groups') {
      const status = searchParams.get('status')
      if (request.method === 'GET') {
        return Response.json(groups.filter((group) => status === null || group.status === status))
      }

      if (request.method === 'POST') {
        const created: Group = {
          id: `group-${groups.length + 1}`,
          status: 'active',
          createdAt: '2026-09-29T08:00:00Z',
          updatedAt: '2026-09-29T08:00:00Z',
          ...body,
        }
        groups = [...groups, created]
        return Response.json(created, { status: 201 })
      }

      if (request.method === 'PATCH') {
        groups = groups.map((group) => (group.id === id ? { ...group, ...body } : group))
        return Response.json(groups.find((group) => group.id === id))
      }

      groups = groups.filter((group) => group.id !== id)
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
