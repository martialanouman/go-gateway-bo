/**
 * L'ossature d'écran, et les deux repères qu'elle doit poser correctement.
 *
 * Le titre est le **seul `h1`** de la page — un lecteur d'écran s'en sert pour savoir où il vient
 * d'arriver, et deux `h1` suppriment ce repère. Le fil d'Ariane est une navigation nommée, dont le
 * dernier maillon n'est pas un lien : pointer vers la page où l'on se trouve déjà n'apprend rien.
 */

import { describe, expect, it } from 'vitest'
import { Button } from '~/components/primitives'
import { renderComponent } from '~/test/render'
import { Page, Toolbar } from './page'

describe('Page', () => {
  it('rend le titre en `h1`, et un seul', () => {
    const { getAllByRole } = renderComponent(<Page title="Connecteurs" />)

    const titles = getAllByRole('heading', { level: 1 })
    expect(titles).toHaveLength(1)
    expect(titles[0]).toHaveTextContent('Connecteurs')
  })

  it('n’est pas un second `banner`', () => {
    // `<main>` n'est **pas** un élément de sectionnement : un `<header>` posé dedans hérite du rôle
    // `banner`, et la page en compte alors deux — celui de la coquille et celui de l'écran. Le
    // défaut a bloqué la suite de tests avant d'être compris.
    const { queryByRole } = renderComponent(<Page title="Connecteurs" />)

    expect(queryByRole('banner')).toBeNull()
  })

  it('rend le fil d’Ariane en navigation nommée', () => {
    const { getByRole } = renderComponent(
      <Page
        title="Orange CI"
        breadcrumbs={[{ label: 'Connecteurs', to: '/connecteurs' }, { label: 'Orange CI' }]}
      />,
    )

    expect(getByRole('navigation', { name: 'Fil d’Ariane' })).toBeInTheDocument()
  })

  it('ne fait pas du dernier maillon un lien', () => {
    const { getByText, queryByRole } = renderComponent(
      <Page
        title="Orange CI"
        breadcrumbs={[{ label: 'Connecteurs', to: '/connecteurs' }, { label: 'Orange CI' }]}
      />,
    )

    // La page courante s'annonce `aria-current`, pas comme un lien vers là où l'on est déjà.
    expect(getByText('Orange CI', { selector: 'span' })).toHaveAttribute('aria-current', 'page')
    expect(queryByRole('link', { name: 'Orange CI' })).toBeNull()
  })

  it('rend les actions et le contenu', () => {
    const { getByRole } = renderComponent(
      <Page title="Connecteurs" actions={<Button>Créer</Button>}>
        <p>Trois connecteurs actifs.</p>
      </Page>,
    )

    expect(getByRole('button', { name: 'Créer' })).toBeInTheDocument()
    expect(getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('Toolbar', () => {
  it('nomme son groupe pour les technologies d’assistance', () => {
    const { getByRole } = renderComponent(
      <Toolbar label="Filtres des connecteurs">
        <Button>Tout afficher</Button>
      </Toolbar>,
    )

    // La légende est masquée visuellement — la barre se lit d'elle-même à l'écran — mais jamais
    // retirée, sinon le groupe redevient anonyme.
    expect(getByRole('group', { name: 'Filtres des connecteurs' })).toBeInTheDocument()
  })
})
