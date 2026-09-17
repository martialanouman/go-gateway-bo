import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '~/router'
import { type SessionOutcome, stubSession } from '../../test/session'

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

describe('le rail', () => {
  it('ne montre que ce que la session ouvre, et tait les groupes vidés', async () => {
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

  it('marque l’entrée de l’écran affiché', async () => {
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

  it('mène à l’état vide de l’entrée choisie', async () => {
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

describe('sans session', () => {
  it('nomme l’écran de connexion à venir, sans navigation', async () => {
    visit('/routes', { status: 401 })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Aucune session ouverte',
    )
    expect(screen.getByText(/step-027/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('quand la session ne peut pas être lue', () => {
  it('dit la réalité HTTP et relit sur demande', async () => {
    const user = userEvent.setup()
    const fetch = visit('/', { status: 503 })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GET /api/auth/me · 503')
    expect(screen.queryByText('Aucune session ouverte')).toBeNull()

    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('ne met pas l’API Admin en cause, et dit une panne réseau quand aucun statut n’est revenu', async () => {
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

describe('pendant la lecture de la session', () => {
  it('garde la silhouette de la coquille et annonce l’attente', async () => {
    visit('/', 'pending')

    expect(await screen.findByText('Ouverture de la session')).toBeInTheDocument()
    expect(document.querySelector('.shell__rail')).not.toBeNull()
  })
})

describe('le lien d’évitement', () => {
  it('est le premier arrêt du clavier et porte le focus sur le contenu', async () => {
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
