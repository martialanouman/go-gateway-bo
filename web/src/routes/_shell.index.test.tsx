import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'

/**
 * Le test monte le vrai arbre de routes derrière le RouterProvider de l'application : un composant
 * importé directement et rendu seul prouverait qu'il sait s'afficher, pas qu'une URL y mène. Le
 * montage réel, lui, est exercé par `main.test.tsx`.
 */
async function visitAndAwaitHeading(path: string) {
  stubSession({ permissions: [] })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)

  return await screen.findByRole('heading', { level: 1 })
}

describe('the home screen', () => {
  it('announces that the cockpit is under construction, under a top-level heading', async () => {
    const heading = await visitAndAwaitHeading('/')

    expect(heading).toHaveTextContent("Le cockpit d'exploitation se construit")
  })

  it('names the milestones that will bring the screens rather than leaving a blank', async () => {
    await visitAndAwaitHeading('/')

    // §1.9 : une surface non encore livrée dit ce qui arrive et quand — jamais une page vide, jamais
    // un écran inventé.
    expect(screen.getByText(/jalon M4/)).toBeInTheDocument()
    expect(screen.getByText(/jalon M1/)).toBeInTheDocument()
  })
})
