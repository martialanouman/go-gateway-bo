import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { routeTree } from '../routeTree.gen'

/**
 * Le comportement de la coquille est décrit ici, à côté d'elle : quand M2 la remplacera par l'AppShell,
 * le test se déplacera avec le code plutôt que d'être cherché sous la route qui l'a exercé.
 */
async function visit(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(<RouterProvider router={router} />)

  return await screen.findByRole('main')
}

describe('la coquille', () => {
  it('expose une navigation nommée et une région de contenu', async () => {
    await visit('/')

    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument()
    // Le landmark principal est ce que vise le lien d'évitement que step-040 posera.
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('une adresse qui ne correspond à aucun écran', () => {
  it('explique la situation en français plutôt que de rendre « Not Found »', async () => {
    await visit('/clients/01960000-0000-7000-8000-000000000000')

    const heading = await screen.findByRole('heading', { level: 1 })

    expect(heading).toHaveTextContent('Cette adresse ne correspond à aucun écran')
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument()
  })

  it('garde la coquille autour du message', async () => {
    // Une adresse inconnue ne fait pas disparaître la navigation : l'opérateur doit pouvoir repartir
    // d'où il est, sans revenir en arrière ni retaper une URL.
    await visit('/inconnu')

    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument()
  })
})
