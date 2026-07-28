import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { routeTree } from '~/routeTree.gen'

/**
 * Test de fumée : l'arbre de routes généré se monte et la route racine rend son contenu.
 *
 * Il vaut plus que son apparence — il échoue dès que `routeTree.gen.ts` est périmé par rapport aux
 * fichiers de `src/routes/`, ce qui est le mode de panne le plus courant du routage par fichiers.
 */
test('la route racine se monte et rend son contenu', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Tableau de bord — Passerelle SMS',
  )
})
