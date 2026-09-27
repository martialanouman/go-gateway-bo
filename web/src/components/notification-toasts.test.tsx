import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'
import { FakeWebSocket } from '../../test/websocket'

type Notification = components['schemas']['Notification']

async function openShell(permissions: readonly PermissionKey[]) {
  const fetch = stubSession({ permissions })
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />,
  )
  await screen.findByRole('navigation', { name: 'Navigation principale' })
  const socket = FakeWebSocket.latest()
  act(() => socket.open())
  return { socket, fetch }
}

function emit(socket: FakeWebSocket, notification: Notification) {
  act(() =>
    socket.receive({
      topic: 'notifications',
      ts: '2026-09-27T08:05:00Z',
      data: notification,
    } satisfies components['schemas']['RealtimeData']),
  )
}

const MO_FLOOR: Notification = {
  id: '01960000-0000-7000-8000-00000000000a',
  source: 'billing_alert_stream',
  severity: 'warning',
  kind: 'billing_alert',
  details: {
    customerId: 'cus-42',
    ownerType: 'smpp_account',
    ownerId: 'acc-7',
    alert: 'mo_floor_reached',
    balance: 1250000,
  },
  createdAt: '2026-09-27T08:05:00Z',
}

const listReads = (fetch: ReturnType<typeof stubSession>) =>
  fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/notifications')
    .length

describe('notification toasts', () => {
  it('pushes a toast for each notification, in the shared copy', async () => {
    const { socket } = await openShell(['billing:read'])

    emit(socket, MO_FLOOR)

    expect(await screen.findByText('Plancher de facturation MO atteint')).toBeInTheDocument()
    expect(
      screen.getByText(
        /^Le solde du compte SMPP acc-7 du client cus-42 est à 1\s250\s000 crédits\.$/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('source · bff')).toBeInTheDocument()
    expect(document.querySelector('.ui-toast--warning')).not.toBeNull()
  })

  it('names Alertmanager as the source of what it detected', async () => {
    const { socket } = await openShell(['alerts:read'])

    emit(socket, {
      id: '01960000-0000-7000-8000-00000000000b',
      source: 'alertmanager',
      severity: 'critical',
      kind: 'message',
      message: 'Connecteur orange-ci injoignable.',
      createdAt: '2026-09-27T08:05:00Z',
    })

    const toast = await screen.findByRole('alertdialog', { hidden: true })
    expect(toast).toHaveTextContent('Connecteur orange-ci injoignable.')
    expect(toast).toHaveTextContent('source · alertmanager')
    expect(toast).toHaveClass('ui-toast--critical')
  })

  it('rereads the notification center on each frame', async () => {
    const { socket, fetch } = await openShell(['billing:read'])
    await vi.waitFor(() => expect(listReads(fetch)).toBe(1))

    emit(socket, MO_FLOOR)

    await vi.waitFor(() => expect(listReads(fetch)).toBe(2))
  })

  it('subscribes to notifications without billing:read, and never to billing.alerts', async () => {
    const { socket } = await openShell([])

    expect(socket.sent).toEqual([{ action: 'subscribe', topics: ['notifications'] }])
  })
})
