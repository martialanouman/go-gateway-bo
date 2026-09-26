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

describe('the visual reference', () => {
  it('is reachable at /_design, and not swallowed by a pathless layout', async () => {
    const heading = await visitDesign()

    expect(heading).toHaveTextContent('Référence visuelle')
  })

  it('lives outside the shell, because it is not meant for an operator', async () => {
    await visitDesign()

    // Pas de navigation principale : la page n'est pas un écran du produit. C'est aussi ce qui la
    // place, structurellement, hors du `beforeLoad` de session que M1 posera sur `_shell`.
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
  })

  it('renders the token families under section headings', async () => {
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
      'Primitives',
      // La modale et les toasts y sont **fermés** : leurs titres sont des `h2`, et cette liste les
      // compterait comme des sections.
      'Retour et états',
    ]

    for (const section of sections) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument()
    }

    // Et pas une de plus qui ne soit annoncée : la liste ci-dessus est la page, pas un
    // échantillon d'elle.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(sections.length)
  })

  it('renders a truly actionable sort header', async () => {
    // **Ce que ce test ferme.** La page passait `sort` sans `onSortChange` : la table rendait alors
    // ses en-têtes triables en **texte inerte**, et posait un `aria-sort` sur une colonne que rien
    // ne rendait actionnable. La référence visuelle ne montrait donc jamais l'état le plus important
    // d'un tableau, dans la page dont la docstring promet qu'on y lit « l'état exact d'un contrôle ».
    await visitDesign()
    const user = userEvent.setup()

    const tri = screen.getByRole('button', { name: /Débit/ })
    // La colonne triée s'annonce, et c'est la seule qui le fait.
    expect(tri.closest('th')).toHaveAttribute('aria-sort', 'descending')

    // **Et les deux états du tri sont montrés côte à côte**, ce qui est tout l'objet d'une page de
    // référence : « Débit » porte le sens du tri, « Connecteur » est triable sans rien annoncer.
    //
    // *(La rédaction précédente cliquait puis assertait `toBeInTheDocument()` sur l'élément qu'elle
    // venait de cliquer — un `Alors` qui porte sur une structure et non sur un effet. La page est un
    // spécimen, son `onSortChange` ne fait rien : il n'y avait aucun effet à observer.)*
    const auRepos = screen.getByRole('button', { name: /Connecteur/ })
    expect(auRepos.closest('th')).not.toHaveAttribute('aria-sort')
    expect(tri.querySelector('.ui-table__sort-glyph')).not.toBeNull()
    expect(
      auRepos.querySelector('.ui-table__sort-glyph'),
      'une colonne non triée annonce un sens de tri',
    ).toBeNull()

    // Le contrôle répond : un en-tête qui ne se laisse pas activer n'est pas un en-tête triable.
    await user.click(tri)
    expect(tri.closest('th')).toHaveAttribute('aria-sort', 'descending')
  })

  it('renders one contrast pair per row of the table the brand test checks', async () => {
    await visitDesign()

    const { CONTRAST_PAIRS } = await import('~/lib/design-tokens')

    // **La table de contraste, pas toutes les lignes de la page.** Compter `getAllByRole('row')` sur
    // le document entier cesse d'être vrai dès qu'une autre section rend un tableau, et peut devenir
    // faux **en restant vert** si deux changements se compensent.
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

  /**
   * **Pourquoi les spécimens flottants démarrent fermés.**
   *
   * `Dialog.Title` et `Toast.Title` de Base UI rendent tous deux un `<h2>`. Le test des sections
   * ci-dessus compte les `h2` de la page et les compare à une liste écrite à la main : une modale
   * ouverte au repos y ajouterait un titre fantôme, et la liste devrait mentir pour rester verte.
   *
   * Ce test exerce le geste **et** montre le mécanisme : le titre de la modale n'est pas là au
   * repos, il l'est une fois ouverte.
   */
  it('opens the modal on click, and its title does not exist before', async () => {
    const user = userEvent.setup()
    await visitDesign()

    expect(screen.queryByRole('heading', { name: 'Déconnecter la session ?' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))

    expect(screen.getByRole('dialog', { name: 'Déconnecter la session ?' })).toBeInTheDocument()
  })

  it('closes the modal with its Annuler button', async () => {
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the modal with its close button', async () => {
    // Les deux sorties, parce que ce sont deux chemins distincts : `Annuler` est une action de
    // l'écran, la croix est celle de la primitive. Une page de référence où seule l'une des deux
    // marcherait laisserait croire que l'autre marche aussi.
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))
    await user.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('makes the two ways out offered by the states actionable', async () => {
    // « Réinitialiser » et « Réessayer » sont la moitié utile de leur état : un `NoResults` qui ne
    // réinitialise rien et un `ErrorState` qui ne réessaie pas sont deux boutons décoratifs, et la
    // page de référence les montrerait comme s'ils agissaient.
    const user = userEvent.setup()
    await visitDesign()

    // Ciblés **dans leur état**, et non par leur nom seul : la section « Primitives » rend déjà un
    // bouton « Réinitialiser » comme spécimen de bouton. Deux homonymes sur une page de référence
    // sont normaux ; un test qui les confond ne l'est pas.
    const aucunResultat = screen.getByText('Aucun message trouvé').closest('.ui-empty')
    const erreur = screen.getByText('Impossible de joindre l’API Admin').closest('.ui-error')

    await user.click(
      within(aucunResultat as HTMLElement).getByRole('button', { name: 'Réinitialiser' }),
    )
    await user.click(within(erreur as HTMLElement).getByRole('button', { name: 'Réessayer' }))

    expect(screen.getByText('Aucun message trouvé')).toBeInTheDocument()
    expect(screen.getByText('Impossible de joindre l’API Admin')).toBeInTheDocument()
  })

  it('pushes one toast per detection stage, each with its source', async () => {
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Toast · alertmanager' }))
    await user.click(screen.getByRole('button', { name: 'Toast · bff' }))

    expect(screen.getByText('source · alertmanager')).toBeInTheDocument()
    expect(screen.getByText('source · bff')).toBeInTheDocument()
  })

  it('renders the five content states, each with its copy', async () => {
    await visitDesign()

    // Les cinq, et surtout **cinq copies distinctes** : c'est la page où l'on vérifie qu'un module
    // désactivé ne se lit pas comme une panne.
    expect(screen.getByText('Aucune règle d’alerte')).toBeInTheDocument()
    expect(screen.getByText('Aucun message trouvé')).toBeInTheDocument()
    expect(screen.getByText('Facturation indisponible')).toBeInTheDocument()
    expect(screen.getByText('Impossible de joindre l’API Admin')).toBeInTheDocument()
    expect(screen.getByText('Chargement des connecteurs')).toBeInTheDocument()
  })
})
