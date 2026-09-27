import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'

type NotificationEntry = components['schemas']['NotificationEntry']

const PAGE_SIZE = 20

function entry(index: number, overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: `01960000-0000-7000-8000-${String(100 - index).padStart(12, '0')}`,
    source: 'billing_alert_stream',
    severity: 'warning',
    kind: 'billing_alert',
    details: {
      customerId: `cust-${index}`,
      ownerType: 'customer',
      ownerId: `cust-${index}`,
      alert: 'mo_floor_reached',
      balance: -5000,
    },
    // Construite en heure locale : l'heure attendue ne dépend pas du fuseau de la machine.
    createdAt: new Date(2026, 8, 27, 8, 5).toISOString(),
    read: false,
    ...overrides,
  }
}

/**
 * Le centre tel que le BFF le sert : pages de 20, curseur sur l'`id`, lecture par opérateur. Tout
 * le reste passe au décor de session.
 */
function openShell({
  permissions = ['billing:read'],
  entries = [],
  failing = false,
  markFailure,
}: {
  readonly permissions?: readonly PermissionKey[]
  readonly entries?: readonly NotificationEntry[]
  readonly failing?: boolean
  readonly markFailure?: { readonly status: number; readonly body?: unknown }
} = {}) {
  const session = stubSession({ permissions })
  const held = entries.map((notification) => ({ ...notification }))
  let down = failing

  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/api/notifications') {
      if (down) {
        return Response.json({ code: 'internal', message: 'Erreur de test.' }, { status: 503 })
      }
      const cursor = url.searchParams.get('cursor')
      const start = cursor === null ? 0 : held.findIndex(({ id }) => id === cursor) + 1
      const items = held.slice(start, start + PAGE_SIZE)
      const more = start + PAGE_SIZE < held.length
      return Response.json({
        items,
        unreadCount: held.filter(({ read }) => !read).length,
        ...(more ? { nextCursor: items.at(-1)?.id } : {}),
      })
    }

    const marked = /^\/api\/notifications\/([^/]+)\/read$/.exec(url.pathname)?.[1]
    if (request.method === 'POST' && marked !== undefined) {
      if (markFailure !== undefined) {
        return markFailure.body === undefined
          ? new Response(null, { status: markFailure.status })
          : Response.json(markFailure.body, { status: markFailure.status })
      }
      const notification = held.find(({ id }) => id === marked)
      if (notification === undefined) {
        return Response.json({ code: 'notification_unknown', message: 'Test.' }, { status: 404 })
      }
      notification.read = true
      return new Response(null, { status: 204 })
    }

    return session(request)
  })
  vi.stubGlobal('fetch', fetch)

  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />,
  )
  return {
    fetch,
    recover: () => {
      down = false
    },
  }
}

const trigger = (name: string | RegExp = /^Notifications/) => screen.findByRole('button', { name })

async function openCenter(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await trigger())
  return screen.findByRole('dialog', { name: 'Notifications' })
}

describe('the notification center trigger', () => {
  it('says how many notifications are unread, not only a number', async () => {
    openShell({ entries: [entry(1), entry(2), entry(3, { read: true })] })

    const button = await trigger('Notifications, 2 non lues')

    expect(button).toHaveTextContent(/^Notifications2$/)
  })

  it('says a single unread notification in the singular', async () => {
    openShell({ entries: [entry(1)] })

    expect(await trigger('Notifications, 1 non lue')).toBeInTheDocument()
  })

  it('claims no count while the list cannot be read', async () => {
    const user = userEvent.setup()
    openShell({ entries: [entry(1)], failing: true })

    const center = await openCenter(user)
    await within(center).findByRole('alert')

    const button = screen.getByRole('button', { name: /^Notifications/ })
    expect(button).toHaveAccessibleName('Notifications')
    expect(button).toHaveTextContent(/^Notifications$/)
  })

  it('shows no count once everything is read', async () => {
    openShell({ entries: [entry(1, { read: true })] })

    expect(await trigger('Notifications, aucune non lue')).toHaveTextContent(/^Notifications$/)
  })
})

describe('the notification center', () => {
  it('lists each notification with its copy, its time and its customer', async () => {
    const user = userEvent.setup()
    openShell({ entries: [entry(9)] })

    const center = await openCenter(user)
    const row = within(center).getByRole('listitem')

    expect(row).toHaveTextContent('Plancher de facturation MO atteint')
    expect(row).toHaveTextContent(/Le solde du client cust-9 est à -5\s000 crédits\./)
    expect(within(row).getByText('08:05')).toBeInTheDocument()
    expect(within(row).getByText('cust-9', { selector: 'code' })).toBeInTheDocument()
  })

  it('marks a notification read, and the count follows', async () => {
    const user = userEvent.setup()
    const { fetch } = openShell({ entries: [entry(1), entry(2)] })
    const center = await openCenter(user)

    const [first] = within(center).getAllByRole('listitem')
    await user.click(
      within(first as HTMLElement).getByRole('button', { name: 'Marquer comme lue' }),
    )

    expect(await trigger('Notifications, 1 non lue')).toBeInTheDocument()
    expect(
      fetch.mock.calls.some(
        ([request]) =>
          request.method === 'POST' &&
          new URL(request.url).pathname === `/api/notifications/${entry(1).id}/read`,
      ),
    ).toBe(true)
  })

  it('shows the server’s refusal when marking a notification fails', async () => {
    const user = userEvent.setup()
    openShell({
      entries: [entry(1)],
      markFailure: { status: 503, body: { code: 'internal', message: 'Erreur de test.' } },
    })
    const center = await openCenter(user)

    await user.click(within(center).getByRole('button', { name: 'Marquer comme lue' }))

    expect(await within(center).findByText('Erreur de test.')).toBeInTheDocument()
  })

  it('falls back to a fixed refusal when the server says nothing', async () => {
    const user = userEvent.setup()
    openShell({ entries: [entry(1)], markFailure: { status: 503 } })
    const center = await openCenter(user)

    await user.click(within(center).getByRole('button', { name: 'Marquer comme lue' }))

    expect(
      await within(center).findByText(
        "La notification n'a pas été marquée comme lue : le serveur n'a pas répondu. Elle reste " +
          'non lue ; réessayer la marque. (HTTP 503).',
      ),
    ).toBeInTheDocument()
  })

  it('loads the next page on demand', async () => {
    const user = userEvent.setup()
    openShell({ entries: Array.from({ length: PAGE_SIZE + 1 }, (_, index) => entry(index + 1)) })
    const center = await openCenter(user)
    expect(within(center).getAllByRole('listitem')).toHaveLength(PAGE_SIZE)

    await user.click(within(center).getByRole('button', { name: 'Afficher les suivantes' }))

    expect(await within(center).findByText(`cust-${PAGE_SIZE + 1}`)).toBeInTheDocument()
    expect(within(center).queryByRole('button', { name: 'Afficher les suivantes' })).toBeNull()
  })

  it('says when there is nothing yet', async () => {
    const user = userEvent.setup()
    openShell()

    const center = await openCenter(user)

    expect(within(center).getByText('Aucune notification pour l’instant.')).toBeInTheDocument()
  })

  it('explains what billing:read would show, rather than hiding it', async () => {
    const user = userEvent.setup()
    openShell({ permissions: [] })

    const center = await openCenter(user)

    expect(within(center).getByText(/^Les alertes de facturation/)).toHaveTextContent(
      'Les alertes de facturation n’apparaissent pas ici : elles exigent la permission billing:read.',
    )
    expect(within(center).getByText('billing:read', { selector: 'code' })).toBeInTheDocument()
  })

  it('does not explain what the operator already holds', async () => {
    const user = userEvent.setup()
    openShell()

    const center = await openCenter(user)

    expect(within(center).queryByText(/n’apparaissent pas ici/)).toBeNull()
  })

  it('does not claim to keep everything', async () => {
    const user = userEvent.setup()
    openShell()
    const hint =
      'Le centre garde les alertes reçues par le serveur ; une bascule ou une panne peut en laisser passer.'

    const center = await openCenter(user)
    expect(center).toHaveAccessibleDescription(hint)

    await user.hover(within(center).getByRole('button', { name: 'Précisions' }))
    expect(await screen.findByText(hint, { selector: '.ui-tooltip' })).toBeInTheDocument()
  })

  it('offers to retry when the list cannot be read', async () => {
    const user = userEvent.setup()
    const { recover } = openShell({ entries: [entry(4)], failing: true })
    const center = await openCenter(user)

    const failure = await within(center).findByRole('alert')
    expect(failure).toHaveTextContent('Impossible de lire les notifications')
    expect(failure).toHaveTextContent('GET /api/notifications · 503')
    recover()
    await user.click(within(failure).getByRole('button', { name: 'Réessayer' }))

    expect(await within(center).findByText('cust-4')).toBeInTheDocument()
  })
})
