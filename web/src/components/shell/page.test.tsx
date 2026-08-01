/**
 * L'ossature d'écran, et les deux repères qu'elle doit poser correctement.
 *
 * Le titre est le **seul `h1`** de la page — un lecteur d'écran s'en sert pour savoir où il vient
 * d'arriver, et deux `h1` suppriment ce repère. Le fil d'Ariane est une navigation nommée, dont le
 * dernier maillon n'est pas un lien : pointer vers la page où l'on se trouve déjà n'apprend rien.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from '~/components/primitives'
import { renderComponent } from '~/test/render'
import { Page, Toolbar } from './page'

/**
 * Un routeur minimal, parce que le fil d'Ariane rend des `Link`.
 *
 * Il en rend depuis que l'ancrage brut a été remplacé : un `<a href>` rechargeait la page entière et
 * faisait perdre le cache Query, la WebSocket et les toasts en cours. Le prix est ce harnais ; il
 * est plus petit que le défaut.
 */
async function renderWithRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  // `load()` avant le rendu, comme `renderRoute` : `RouterProvider` ne rend le composant d'une route
  // qu'une fois celle-ci résolue. Sans cette attente, le conteneur reste vide et l'assertion échoue
  // sur une absence qui n'a rien à voir avec ce qu'on teste.
  await router.load()

  return renderComponent(<RouterProvider router={router} />)
}

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

  it('rend le fil d’Ariane en navigation nommée', async () => {
    const { getByRole } = await renderWithRouter(
      <Page
        title="Orange CI"
        breadcrumbs={[{ label: 'Connecteurs', to: '/connecteurs' }, { label: 'Orange CI' }]}
      />,
    )

    expect(getByRole('navigation', { name: 'Fil d’Ariane' })).toBeInTheDocument()
  })

  it('ne fait pas du dernier maillon un lien', async () => {
    const { getByText, queryByRole } = await renderWithRouter(
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
