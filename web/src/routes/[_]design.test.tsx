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
      // step-042. La modale et les toasts y sont **fermés** : leurs titres sont des `h2`, et cette
      // liste les compterait comme des sections.
      'Retour et états',
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
  it('ouvre la modale au clic, et son titre n’existe pas avant', async () => {
    const user = userEvent.setup()
    await visitDesign()

    expect(screen.queryByRole('heading', { name: 'Déconnecter la session ?' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))

    expect(screen.getByRole('dialog', { name: 'Déconnecter la session ?' })).toBeInTheDocument()
  })

  it('referme la modale par son bouton Annuler', async () => {
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('referme la modale par sa croix', async () => {
    // Les deux sorties, parce que ce sont deux chemins distincts : `Annuler` est une action de
    // l'écran, la croix est celle de la primitive. Une page de référence où seule l'une des deux
    // marcherait laisserait croire que l'autre marche aussi.
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Ouvrir la modale' }))
    await user.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('rend actionnables les deux issues que les états proposent', async () => {
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

  it('pousse un toast par étage de détection, chacun avec sa source', async () => {
    const user = userEvent.setup()
    await visitDesign()

    await user.click(screen.getByRole('button', { name: 'Toast · alertmanager' }))
    await user.click(screen.getByRole('button', { name: 'Toast · bff' }))

    expect(screen.getByText('source · alertmanager')).toBeInTheDocument()
    expect(screen.getByText('source · bff')).toBeInTheDocument()
  })

  it('rend les cinq états de contenu, chacun avec sa copie', async () => {
    await visitDesign()

    // Les cinq, et surtout **cinq copies distinctes** : c'est la page où un relecteur vérifie qu'un
    // module désactivé ne se lit pas comme une panne.
    expect(screen.getByText('Aucune règle d’alerte')).toBeInTheDocument()
    expect(screen.getByText('Aucun message trouvé')).toBeInTheDocument()
    expect(screen.getByText('Facturation indisponible')).toBeInTheDocument()
    expect(screen.getByText('Impossible de joindre l’API Admin')).toBeInTheDocument()
    expect(screen.getByText('Chargement des connecteurs')).toBeInTheDocument()
  })
})
