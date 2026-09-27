import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { meQueryOptions } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'
import { FakeWebSocket } from '../../test/websocket'

type BillingAlert = components['schemas']['BillingAlert']

async function openShell(permissions: readonly PermissionKey[]) {
  stubSession({ permissions })
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />,
  )
  await screen.findByRole('navigation', { name: 'Navigation principale' })
  const socket = FakeWebSocket.latest()
  act(() => socket.open())
  return socket
}

function emit(socket: FakeWebSocket, alert: BillingAlert) {
  act(() =>
    socket.receive({
      topic: 'billing.alerts',
      ts: '2026-09-27T08:05:00Z',
      data: alert,
    } satisfies components['schemas']['RealtimeData']),
  )
}

const billingSubscriptions = (socket: FakeWebSocket) =>
  socket.sent.filter(
    (message) =>
      (message as { topics: string[] }).topics.includes('billing.alerts') &&
      (message as { action: string }).action === 'subscribe',
  )

describe('billing alert toasts', () => {
  it('pushes a toast for each billing alert', async () => {
    const socket = await openShell(['billing:read'])

    emit(socket, {
      customerId: 'cus-42',
      ownerType: 'smpp_account',
      ownerId: 'acc-7',
      alert: 'mo_floor_reached',
      balance: 1250000,
    })

    expect(await screen.findByText('Plancher de facturation MO atteint')).toBeInTheDocument()
    // Espace fine insécable en fr-FR : l'expression tolère l'espace de groupement quel qu'il soit.
    expect(
      screen.getByText(
        /^Le solde du compte SMPP acc-7 du client cus-42 est à 1\s250\s000 crédits\.$/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('source · bff')).toBeInTheDocument()
    expect(document.querySelector('.ui-toast--warning')).not.toBeNull()
  })

  it('names the customer alone when the balance is the customer own', async () => {
    const socket = await openShell(['billing:read'])

    emit(socket, {
      customerId: 'cus-42',
      ownerType: 'customer',
      ownerId: 'cus-42',
      alert: 'mo_floor_reached',
      balance: 12,
    })

    expect(
      await screen.findByText('Le solde du client cus-42 est à 12 crédits.'),
    ).toBeInTheDocument()
  })

  it('keeps the raw owner type for a scope the contract does not list', async () => {
    const socket = await openShell(['billing:read'])

    emit(socket, {
      customerId: 'cus-42',
      ownerType: 'reseller',
      ownerId: 'res-3',
      alert: 'mo_floor_reached',
      balance: 12,
    })

    expect(
      await screen.findByText('Le solde reseller res-3 du client cus-42 est à 12 crédits.'),
    ).toBeInTheDocument()
  })

  it('names an unknown alert without inventing its meaning', async () => {
    const socket = await openShell(['billing:read'])

    emit(socket, {
      customerId: 'cus-42',
      ownerType: 'smpp_account',
      ownerId: 'acc-7',
      alert: 'credit_limit_near',
      balance: 3,
    })

    expect(await screen.findByText('Alerte de facturation')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Alerte « credit_limit_near » sur le solde du compte SMPP acc-7 du client cus-42.',
      ),
    ).toBeInTheDocument()
  })

  it('does not subscribe without billing:read', async () => {
    const socket = await openShell([])

    expect(billingSubscriptions(socket)).toHaveLength(0)
  })

  it('keeps a single subscription while toasts come and go', async () => {
    const socket = await openShell(['billing:read'])
    const alert = {
      customerId: 'cus-42',
      ownerType: 'smpp_account',
      ownerId: 'acc-7',
      alert: 'mo_floor_reached',
      balance: 12,
    }

    emit(socket, alert)
    await screen.findByText('Plancher de facturation MO atteint')
    emit(socket, alert)

    expect(socket.sent).toEqual([{ action: 'subscribe', topics: ['billing.alerts'] }])
  })

  it('unsubscribes once the session loses billing:read', async () => {
    const socket = await openShell(['billing:read'])
    expect(billingSubscriptions(socket)).toHaveLength(1)

    // Le rôle a changé côté serveur ; l'onglet reprend le focus une fois la session périmée.
    stubSession({ permissions: [] })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + Number(meQueryOptions.staleTime) + 1000)
      act(() => window.dispatchEvent(new Event('visibilitychange')))
      // La relecture part après une microtâche de Query : l'horloge reste avancée jusque-là.
      await vi.waitFor(() =>
        expect(socket.sent).toContainEqual({ action: 'unsubscribe', topics: ['billing.alerts'] }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
