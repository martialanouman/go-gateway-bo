import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '~/router'
import { OPERATOR_NAME, type SessionOutcome, stubSession } from '../../test/session'
import { FakeWebSocket } from '../../test/websocket'

/**
 * La coquille telle que l'application la monte : vrai routeur, vrai `QueryClient`, vrai client HTTP.
 * Seul `fetch` est remplacé.
 */
function visit(path: string, session: SessionOutcome) {
  const fetch = stubSession(session)
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: [path] }))} />,
  )
  return fetch
}

const rail = () => screen.findByRole('navigation', { name: 'Navigation principale' })

describe('the rail', () => {
  it('shows only what the session grants, and hides emptied groups', async () => {
    visit('/', { permissions: ['routes:read'] })
    const nav = await rail()
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent)

    // Trafic et CDR n'exigent aucune clé ; Routes et Numéros exacts suivent `routes:read`.
    expect(labels).toEqual(['SMS Gateway', 'Trafic', 'CDR Explorer', 'Routes', 'Numéros exacts'])
    expect(within(nav).queryByText('Clients')).toBeNull()
    expect(within(nav).queryByText('Facturation')).toBeNull()
    expect(within(nav).getByText('Routage')).toBeInTheDocument()
  })

  it('marks the entry of the displayed screen', async () => {
    visit('/routes', { permissions: ['routes:read'] })
    const nav = await rail()

    expect(within(nav).getByRole('link', { name: 'Routes' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Numéros exacts' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('leads to the empty state of the chosen entry', async () => {
    const user = userEvent.setup()
    visit('/', { permissions: ['billing:read'] })

    await user.click(within(await rail()).getByRole('link', { name: 'Plans tarifaires' }))

    // Le titre est attendu par son nom : le `h1` de l'accueil est encore là au moment du clic.
    expect(
      await screen.findByRole('heading', { level: 1, name: /Plans tarifaires/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/jalon M8 /)).toBeInTheDocument()
  })
})

describe('without a session', () => {
  it('offers sign-in from an unknown address, without navigation', async () => {
    // Une adresse inconnue, et non un écran : la garde de `_shell` renvoie les écrans à `/login`
    // avant tout rendu. Ce qui reste ici est le seul chemin qui rend la coquille **hors** de la
    // garde — le `notFoundComponent` de la racine.
    visit('/cette-adresse-nexiste-pas', { status: 401 })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Aucune session ouverte',
    )
    expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('when the session cannot be read', () => {
  it('states the HTTP reality and rereads on demand', async () => {
    const user = userEvent.setup()
    const fetch = visit('/', { status: 503 })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GET /api/auth/me · 503')
    expect(screen.queryByText('Aucune session ouverte')).toBeNull()

    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not blame the Admin API, and reports a network failure when no status came back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(
      <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Impossible de vérifier la session')
    expect(alert).not.toHaveTextContent('API Admin')
    expect(alert).toHaveTextContent('GET /api/auth/me · réseau')
  })
})

describe('while the session is being read', () => {
  it('keeps the shell silhouette and announces the wait', async () => {
    // La garde de route n'a pas encore décidé : c'est son `pendingComponent` qui peint, et il doit
    // reprendre la silhouette qu'`index.html` a servie. Sans lui, cet écran est **vide** le temps de
    // l'aller-retour.
    visit('/', 'pending')

    expect(await screen.findByText('Ouverture de la session')).toBeInTheDocument()
    expect(document.querySelector('.shell__rail')).not.toBeNull()
  })
})

describe('the top bar', () => {
  it('names the signed-in operator', async () => {
    visit('/', { permissions: [] })
    const banner = await screen.findByRole('banner')
    expect(await within(banner).findByText(OPERATOR_NAME)).toBeInTheDocument()
  })

  it('closes the session and returns to the state that explains it', async () => {
    const user = userEvent.setup()
    const fetch = visit('/', { permissions: [] })

    await user.click(await screen.findByRole('button', { name: 'Se déconnecter' }))

    expect(
      await screen.findByRole('heading', { name: 'Aucune session ouverte' }),
    ).toBeInTheDocument()
    const logout = fetch.mock.calls
      .map(([request]) => request as Request)
      .find((request) => request.method === 'POST')
    expect(new URL(logout?.url ?? '').pathname).toBe('/api/auth/logout')
  })
})

describe('the skip link', () => {
  it('is the first keyboard stop and moves focus to the content', async () => {
    const user = userEvent.setup()
    visit('/', { permissions: [] })
    await rail()

    await user.tab()
    const skip = screen.getByRole('link', { name: 'Aller au contenu' })
    expect(skip).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })
})

describe('the realtime socket', () => {
  it('opens the realtime socket only once a session is known', async () => {
    visit('/cette-adresse-nexiste-pas', { status: 401 })
    await screen.findByRole('heading', { name: 'Aucune session ouverte' })
    expect(FakeWebSocket.instances).toHaveLength(0)

    visit('/', { permissions: [] })
    await rail()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.latest().url).toBe(`ws://${window.location.host}/ws`)
  })

  it('keeps a single live socket under StrictMode', async () => {
    // `main.tsx` monte l'application sous `StrictMode`, qui joue chaque effet deux fois.
    stubSession({ permissions: [] })
    render(
      <StrictMode>
        <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))} />
      </StrictMode>,
    )
    await rail()

    const live = FakeWebSocket.instances.filter(
      (socket) => socket.readyState !== FakeWebSocket.CLOSED,
    )
    expect(live).toHaveLength(1)
  })

  it('a 4401 close brings the no-session screen', async () => {
    visit('/', { permissions: [] })
    await rail()
    const socket = FakeWebSocket.latest()
    act(() => socket.open())

    // Le serveur a fermé la session : la relecture de `me` qui suit la fermeture rend 401.
    stubSession({ status: 401 })
    act(() => socket.close(4401))

    expect(
      await screen.findByRole('heading', { name: 'Aucune session ouverte' }),
    ).toBeInTheDocument()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
