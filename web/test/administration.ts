import { vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { type SessionOutcome, stubSession } from './session'

type Operator = components['schemas']['Operator']
type Role = components['schemas']['Role']
type Group = components['schemas']['CustomerGroup']
type Customer = components['schemas']['Customer']
type SenderId = components['schemas']['SenderId']
type Account = components['schemas']['SmppAccount']
type Webhook = components['schemas']['Webhook']
type AccountSession = components['schemas']['AccountSession']
type Credential = components['schemas']['Credential']
type BindFailure = components['schemas']['BindFailure']

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
  memberCount: 1,
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

export function sender(overrides: Partial<SenderId> = {}): SenderId {
  return {
    id: 'sender-1',
    address: 'ACME',
    status: 'active',
    trafficCategory: 'marketing',
    rateLimit: null,
    recentCategoryMismatches24h: 0,
    firstUsedAt: null,
    createdAt: '2026-09-30T08:00:00Z',
    ...overrides,
  }
}

export const OTP_ACCOUNT: Account = {
  id: '0192b3c4-0000-7000-8000-0000000a0001',
  customerId: ACME.id,
  name: 'trafic-otp',
  status: 'active',
  smppEnabled: true,
  restEnabled: true,
  querySmEnabled: true,
  cancelSmEnabled: true,
  allowedBindTypes: 'trx',
  maxSessions: 4,
  createdAt: '2026-10-01T08:00:00Z',
}

/** Le secret que le faux BFF rend à la création et à la rotation d'un webhook. */
export const WEBHOOK_SECRET = 'c2VjcmV0LWRlLXRlc3QtcXVpLW5lLXNlcnQtcXUnaWNp'

/** Le secret que le faux BFF rend à la création et à la rotation d'un identifiant. */
export const CREDENTIAL_SECRET = 'sgw_c2VjcmV0LWQtaWRlbnRpZmlhbnQtZGUtdGVzdA'

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
    senders?: SenderId[]
    accounts?: Account[]
    webhooks?: Webhook[]
    credentials?: Credential[]
    /** Les binds ouverts de chaque compte servi, tous comptes confondus. */
    sessions?: AccountSession[]
    /** Ce que la passerelle compte, qui peut dépasser la liste (`list-account-sessions`). */
    activeBinds?: number
    /** Les binds refusés de chaque compte servi, tous comptes confondus. */
    bindFailures?: BindFailure[]
  } = {},
  replies: AdministrationReplies = {},
) {
  const session = stubSession(outcome)
  let operators = [...(initial.operators ?? [SELF, COLLEAGUE])]
  let roles = [...(initial.roles ?? [SUPER_ADMIN, AUDITOR, ON_CALL])]
  let groups = [...(initial.groups ?? [RESELLERS])]
  let customers = [...(initial.customers ?? [ACME])]
  let senders = [...(initial.senders ?? [])]
  let accounts = [...(initial.accounts ?? [])]
  let webhooks = [...(initial.webhooks ?? [])]
  let credentials = [...(initial.credentials ?? [])]
  const sessions = initial.sessions ?? []
  const activeBinds = initial.activeBinds ?? sessions.length
  const customerPageSize = initial.customerPageSize ?? 50

  const fetch = vi.fn(async (request: Request) => {
    const { pathname, searchParams } = new URL(request.url)
    const route = `${request.method} ${pathname}`
    const declared = replies[route]
    if (declared !== undefined) return respond(declared)

    const [, , collection, id, detail, detailId, detailAction] = pathname.split('/')
    // `POST /operators/{id}/access-link` n'a pas de corps ; `request.json()` sur un flux vide lève.
    const raw =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text()
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

    if (collection === 'accounts' && id !== undefined) {
      const target = accounts.find((account) => account.id === id)
      if (target === undefined) return respond({ status: 404, body: refusal('not_found') })
      if (detail === 'webhooks') {
        if (request.method === 'POST' && detailId === undefined) {
          const created: Webhook = {
            id: `webhook-${webhooks.length + 1}`,
            status: 'active',
            ...body,
          }
          webhooks = [...webhooks, created]
          return Response.json({ webhook: created, secret: WEBHOOK_SECRET }, { status: 201 })
        }
        const webhook = webhooks.find((candidate) => candidate.id === detailId)
        if (detailAction === 'secret') return Response.json({ webhook, secret: WEBHOOK_SECRET })
        if (request.method === 'PATCH') {
          webhooks = webhooks.map((candidate) =>
            candidate.id === detailId ? { ...candidate, ...body } : candidate,
          )
          return Response.json(webhooks.find((candidate) => candidate.id === detailId))
        }
        if (request.method === 'DELETE') {
          webhooks = webhooks.filter((candidate) => candidate.id !== detailId)
          return new Response(null, { status: 204 })
        }
        return Response.json(webhooks)
      }
      if (detail === 'credentials') {
        if (request.method === 'POST' && detailId === undefined) {
          const created: Credential = {
            id: `credential-${credentials.length + 1}`,
            type: body.type,
            systemId: body.systemId ?? null,
            status: 'active',
            lastUsedAt: null,
            graceExpiresAt: null,
            createdAt: '2026-10-04T10:00:00Z',
            rotatedAt: null,
          }
          credentials = [...credentials, created]
          return Response.json({ credential: created, secret: CREDENTIAL_SECRET }, { status: 201 })
        }
        if (detailAction === 'rotate') {
          const grace: number | undefined = body?.gracePeriodSec
          credentials = credentials.map((candidate) =>
            candidate.id === detailId
              ? {
                  ...candidate,
                  status: 'active',
                  rotatedAt: '2026-10-04T12:00:00Z',
                  graceExpiresAt: grace
                    ? new Date(Date.UTC(2026, 9, 4, 12) + grace * 1000).toISOString()
                    : null,
                }
              : candidate,
          )
          const rotated = credentials.find((candidate) => candidate.id === detailId)
          return Response.json({ credential: rotated, secret: CREDENTIAL_SECRET })
        }
        if (request.method === 'DELETE') {
          credentials = credentials.map((candidate) =>
            candidate.id === detailId ? { ...candidate, status: 'revoked' } : candidate,
          )
          return new Response(null, { status: 204 })
        }
        return Response.json(credentials)
      }
      if (detail === 'bind-failures') {
        return Response.json(initial.bindFailures ?? [])
      }
      if (detail === 'sessions') {
        return Response.json({ maxSessions: target.maxSessions, active: activeBinds, sessions })
      }
      const updated = request.method === 'PUT' ? { ...target, ...body } : target
      accounts = accounts.map((account) => (account.id === id ? updated : account))
      return Response.json(updated)
    }

    if (collection === 'accounts') {
      if (request.method === 'POST') {
        const created: Account = {
          id: `account-${accounts.length + 1}`,
          status: 'active',
          smppEnabled: true,
          restEnabled: true,
          querySmEnabled: true,
          cancelSmEnabled: true,
          allowedBindTypes: 'trx',
          maxSessions: 1,
          createdAt: '2026-10-03T08:00:00Z',
          ...body,
        }
        accounts = [...accounts, created]
        return Response.json(created, { status: 201 })
      }
      const customerId = searchParams.get('customerId')
      const listed = accounts.filter(
        (account) => customerId === null || account.customerId === customerId,
      )
      const start = Number(searchParams.get('cursor') ?? 0)
      const end = start + customerPageSize
      return Response.json({
        items: listed.slice(start, end),
        ...(end < listed.length ? { nextCursor: String(end) } : {}),
      })
    }

    if (collection === 'customers' && id !== undefined) {
      const target = customers.find((customer) => customer.id === id)
      if (target === undefined) return respond({ status: 404, body: refusal('not_found') })
      if (detail === 'sender-ids') {
        if (request.method === 'POST') {
          const created = sender({
            id: `sender-${senders.length + 1}`,
            address: body.address,
            status: 'pending_carrier_approval',
          })
          senders = [...senders, created]
          return Response.json(created, { status: 201 })
        }
        if (detailAction === 'rate-limit') {
          const rateLimit =
            request.method === 'PUT'
              ? { maxPerSec: body.maxPerSec, burstCapacity: body.burstCapacity ?? body.maxPerSec }
              : null
          senders = senders.map((candidate) =>
            candidate.id === detailId ? { ...candidate, rateLimit } : candidate,
          )
          return request.method === 'PUT'
            ? Response.json(senders.find((candidate) => candidate.id === detailId))
            : new Response(null, { status: 204 })
        }
        if (request.method === 'PATCH') {
          senders = senders.map((candidate) =>
            candidate.id === detailId ? { ...candidate, ...body } : candidate,
          )
          return Response.json(senders.find((candidate) => candidate.id === detailId))
        }
        if (request.method === 'DELETE') {
          if (senders.find((candidate) => candidate.id === detailId)?.firstUsedAt)
            return respond({
              status: 409,
              body: {
                code: 'conflict',
                message:
                  'Ce nom a déjà servi à envoyer : il ne se supprime plus, désactivez-le plutôt.',
              },
            })
          senders = senders.filter((candidate) => candidate.id !== detailId)
          return new Response(null, { status: 204 })
        }
        return Response.json(senders)
      }
      if (detail === 'suspension-impact')
        return Response.json({ accounts: 0, activeAccounts: 0, closedAccounts: 0 })

      let updated = target
      if (detail === 'suspend') updated = { ...target, status: 'suspended' }
      if (detail === 'reactivate') updated = { ...target, status: 'active' }
      if (request.method === 'PATCH') updated = { ...target, ...body }
      if (detail === 'group') updated = { ...target, groupId: body.groupId }
      customers = customers.map((customer) => (customer.id === id ? updated : customer))
      return Response.json(updated)
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
      if (request.method === 'GET' && id !== undefined) {
        const found = groups.find((group) => group.id === id)
        return found === undefined
          ? respond({ status: 404, body: refusal('not_found') })
          : Response.json(found)
      }
      if (request.method === 'GET') {
        return Response.json(groups.filter((group) => status === null || group.status === status))
      }

      if (request.method === 'POST') {
        const created: Group = {
          id: `group-${groups.length + 1}`,
          status: 'active',
          memberCount: 0,
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
