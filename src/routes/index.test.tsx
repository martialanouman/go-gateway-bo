import { screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { renderRoute } from '~/test/render-route'

/**
 * Test de fumée : l'arbre de routes généré se monte et la route racine rend son contenu.
 *
 * Il couvre le câblage — arbre de routes, `RouterProvider`, rendu du composant — mais pas la
 * fraîcheur de `routeTree.gen.ts` : Vitest lit le fichier commité tel quel et passerait sur un arbre
 * périmé. C'est la porte `build` de la CI qui le régénère et refuse un diff.
 */
test('la route racine se monte et rend son contenu', async () => {
  await renderRoute('/')

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Tableau de bord — Passerelle SMS',
  )
})
