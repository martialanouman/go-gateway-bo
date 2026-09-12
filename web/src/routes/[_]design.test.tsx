import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    // **Les six, pas quatre.** Mesuré le 08/08/2026 : avec la liste amputée de « Rayons » et
    // « Contraste », supprimer la section Rayons de la page laissait les 137 tests verts. Une page de
    // référence à laquelle il manque un tiers de la charte est pire qu'absente : on la croit
    // complète.
    const sections = [
      'Typographie',
      'Surfaces',
      'Accent et sémantique',
      'Espacements',
      'Rayons',
      'Contraste',
      // step-041. La page ne montrait que des tokens ; elle montre maintenant ce qu'ils habillent.
      'Primitives',
    ]

    for (const section of sections) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    }

    // Et pas une de plus qui ne soit annoncée : la liste ci-dessus est la page, pas un
    // échantillon d'elle.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(sections.length)
  })

  it('rend un en-tête de tri réellement actionnable', async () => {
    // **Ce que ce test ferme.** La page passait `sort` sans `onSortChange` : la table rendait alors
    // ses en-têtes triables en **texte inerte**, et posait un `aria-sort` sur une colonne que rien
    // ne rendait actionnable. La référence visuelle ne montrait donc jamais l'état le plus important
    // d'un tableau, dans la page dont la docstring promet qu'on y lit « l'état exact d'un contrôle ».
    await visitDesign()
    const user = userEvent.setup()

    const tri = screen.getByRole('button', { name: /Débit/ })
    // La colonne triée s'annonce, et c'est la seule qui le fait.
    expect(tri.closest('th')).toHaveAttribute('aria-sort', 'descending')

    // Et le contrôle répond — la page est un spécimen, le tri n'a rien à trier, mais un en-tête qui
    // ne se laisse pas activer n'est pas un en-tête triable.
    await user.click(tri)
    expect(tri).toBeInTheDocument()
  })

  it('rend une paire de contraste par ligne de la table que le test de charte vérifie', async () => {
    await visitDesign()

    const { CONTRAST_PAIRS } = await import('~/lib/design-tokens')

    // **La table de contraste, pas toutes les lignes de la page.** La version précédente comptait
    // `getAllByRole('row')` sur le document entier : elle a cessé d'être vraie à la minute où la
    // section « Primitives » a rendu un spécimen de `DataTable`, et elle aurait aussi bien pu
    // devenir fausse **en restant verte** si deux changements s'étaient compensés.
    const contrast = screen
      .getAllByRole('table')
      .find((table) => table.className.includes('design__table'))
    expect(contrast, 'la table de contraste a disparu de la page').toBeDefined()

    // `-1` : l'en-tête est une ligne comme les autres pour ARIA. Ce qui compte est que la page rende
    // **toute** la table — sinon « chaque paire utilisée par /_design » deviendrait faux sans que
    // rien ne le dise, et le test de contraste garderait des paires que personne n'affiche.
    const rows = within(contrast as HTMLElement).getAllByRole('row')
    expect(rows.length - 1).toBe(CONTRAST_PAIRS.length)
  })
})
