import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { routeTree } from '~/routeTree.gen'

/**
 * Test de fumée : l'arbre de routes généré se monte et la route racine rend son contenu.
 *
 * Il couvre le câblage — arbre de routes, `RouterProvider`, rendu du composant — mais pas la
 * fraîcheur de `routeTree.gen.ts` : Vitest lit le fichier commité tel quel et passerait sur un arbre
 * périmé. C'est la porte `build` de la CI qui le régénère et refuse un diff.
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
