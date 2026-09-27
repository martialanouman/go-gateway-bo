import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'
import { FakeWebSocket } from '../../test/websocket'

type RealtimeStatus = components['schemas']['RealtimeStatus']

// L'indicateur agrège les sujets abonnés : `billing:read` en fait abonner un par le produit lui-même.
async function openShell(permissions: readonly PermissionKey[] = ['billing:read']) {
  stubSession({ permissions })
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />,
  )
  await screen.findByRole('navigation', { name: 'Navigation principale' })
  const socket = FakeWebSocket.latest()
  act(() => socket.open())
  return { socket, banner: screen.getByRole('banner') }
}

function status(socket: FakeWebSocket, message: Omit<RealtimeStatus, 'topic'>) {
  act(() => socket.receive({ topic: 'billing.alerts', ...message } satisfies RealtimeStatus))
}

const INDICATOR = /En direct|Reconnexion|Données périmées|Session terminée/

describe('the realtime indicator', () => {
  it('says the data is live, with a pulse', async () => {
    const { socket, banner } = await openShell()

    status(socket, { status: 'live' })

    expect(within(banner).getByRole('status')).toHaveTextContent('En direct')
  })

  it('says it is reconnecting once the socket drops, without a pulse', async () => {
    const { socket, banner } = await openShell()
    status(socket, { status: 'live' })

    act(() => socket.close(1006))

    expect(within(banner).getByText('Reconnexion')).toBeInTheDocument()
    expect(within(banner).queryByRole('status')).toBeNull()
  })

  it('says since when the data is stale', async () => {
    const { socket, banner } = await openShell()

    // Construite en heure locale : l'attendu ne dépend pas du fuseau de la machine.
    status(socket, { status: 'stale', since: new Date(2026, 8, 27, 8, 5).toISOString() })

    expect(within(banner).getByText('Données périmées')).toBeInTheDocument()
    expect(within(banner).getByText('depuis 08:05')).toBeInTheDocument()
    expect(within(banner).queryByRole('status')).toBeNull()
  })

  it('gives no time for a stream never joined', async () => {
    const { socket, banner } = await openShell()

    status(socket, { status: 'stale' })

    expect(within(banner).getByText('Données périmées')).toBeInTheDocument()
    expect(within(banner).queryByText(/depuis/)).toBeNull()
  })

  it('says the session ended when the server closes it', async () => {
    const { socket, banner } = await openShell()
    status(socket, { status: 'live' })

    // La relecture de la session n'a pas encore répondu : la barre reste, et dit pourquoi.
    stubSession('pending')
    act(() => socket.close(4401))

    expect(within(banner).getByText('Session terminée')).toBeInTheDocument()
    expect(within(banner).queryByRole('status')).toBeNull()
  })

  it('shows nothing while no topic is subscribed', async () => {
    const { banner } = await openShell([])

    expect(within(banner).queryByText(INDICATOR)).toBeNull()
  })
})
