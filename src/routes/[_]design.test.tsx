import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { routeTree } from '~/routeTree.gen'

/**
 * La page de référence visuelle se monte, et sa structure reste navigable.
 *
 * Ce n'est pas un test d'apparence — aucun test ne dira si une couleur est juste. Il garde deux
 * choses qu'une relecture visuelle ne voit pas : que le segment `_design` est bien resté une route
 * atteignable (le nom de fichier est échappé pour ça), et que la page se parcourt au clavier et au
 * lecteur d'écran comme n'importe quel écran du produit.
 */
async function renderDesignPage() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/_design'] }),
  })

  render(<RouterProvider router={router} />)
  return await screen.findByRole('heading', { level: 1 })
}

describe('/_design', () => {
  test('est une route atteignable et non une mise en page sans chemin', async () => {
    // Nommé `_design.tsx`, ce fichier serait devenu une route de layout et l'URL n'existerait pas.
    // Ce test échouerait alors sur un écran vide — c'est là tout son intérêt.
    expect(await renderDesignPage()).toHaveTextContent('Référence visuelle')
  })

  test('présente les familles de tokens de la charte', async () => {
    await renderDesignPage()

    for (const titre of [
      'Typographie',
      'Surfaces',
      'Accent et sémantique',
      'États',
      'Espacements',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: titre })).toBeInTheDocument()
    }
  })

  test('nomme les états par leur libellé, pas seulement par leur couleur', async () => {
    // WCAG 1.4.1 : la couleur ne peut pas être le seul véhicule d'une information. Les libellés
    // restent ceux de l'API, en snake_case — c'est ce qu'un opérateur cherche dans les logs.
    await renderDesignPage()

    const etats = screen.getByRole('heading', { level: 2, name: 'États' }).closest('section')
    expect(etats).not.toBeNull()

    for (const label of ['bound', 'reconnecting', 'unbound', 'half_open']) {
      expect(within(etats as HTMLElement).getByText(label)).toBeInTheDocument()
    }
  })

  test('ne saute aucun niveau de titre', async () => {
    // Un lecteur d'écran navigue par la hiérarchie des titres : un saut de h1 à h3 lui fait
    // manquer un niveau entier de structure.
    await renderDesignPage()

    const niveaux = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)))
      .filter((niveau) => Number.isFinite(niveau))

    expect(niveaux[0]).toBe(1)
    for (const [index, niveau] of niveaux.entries()) {
      const precedent = niveaux[index - 1]
      if (precedent !== undefined) expect(niveau - precedent).toBeLessThanOrEqual(1)
    }
  })
})
