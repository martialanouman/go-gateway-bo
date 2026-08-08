import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '~/router'

/**
 * `/_design` s'adresse à qui écrit un écran, pas à un opérateur. Deux conséquences se testent ici, et
 * elles tiennent toutes deux à un détail de nommage : le fichier s'appelle `[_]design.tsx` et non
 * `_design.tsx`, parce qu'un segment préfixé d'un souligné est, dans TanStack Router, une **mise en
 * page sans chemin** — la page ne serait alors atteignable par aucune URL. Les crochets échappent le
 * caractère et rendent le segment littéral.
 *
 * Ce que ce fichier n'observe pas : le contraste des paires qu'elle rend, tenu par
 * `test/charte.test.ts`, qui lit les mêmes tables ; ni l'absence de requête vers un tiers, tenue par
 * le parcours Playwright contre le binaire.
 */
async function visitDesign() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/_design'] }))

  render(<RouterProvider router={router} />)

  return await screen.findByRole('heading', { level: 1 })
}

describe('la référence visuelle', () => {
  it('est atteignable à /_design, et non avalée par une mise en page sans chemin', async () => {
    const heading = await visitDesign()

    expect(heading).toHaveTextContent('Référence visuelle')
  })

  it('vit hors de la coquille, parce qu’elle ne s’adresse pas à un opérateur', async () => {
    await visitDesign()

    // Pas de navigation principale : la page n'est pas un écran du produit. C'est aussi ce qui la
    // place, structurellement, hors du `beforeLoad` de session que M1 posera sur `_shell`.
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
  })

  it('rend les familles de tokens sous des titres de section', async () => {
    await visitDesign()

    for (const section of ['Typographie', 'Surfaces', 'Accent et sémantique', 'Espacements']) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    }
  })

  it('rend une paire de contraste par ligne de la table que le test de charte vérifie', async () => {
    await visitDesign()

    const { CONTRAST_PAIRS } = await import('~/lib/design-tokens')
    const rows = screen.getAllByRole('row')

    // `-1` : l'en-tête du tableau est une ligne comme les autres pour ARIA. Ce qui compte est que la
    // page rende **toute** la table — sinon « chaque paire utilisée par /_design » deviendrait faux
    // sans que rien ne le dise, et le test de contraste garderait des paires que personne n'affiche.
    expect(rows.length - 1).toBe(CONTRAST_PAIRS.length)
  })
})
