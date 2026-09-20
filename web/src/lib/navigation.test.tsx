import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'
import { NAV_ENTRIES, NAV_GROUPS, type NavPath, navEntry } from './navigation'

describe('la table de navigation', () => {
  it('reprend les cinq groupes et quinze entrées de la charte', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      'Exploitation',
      'Clients',
      'Routage',
      'Conformité',
      'Facturation',
    ])
    expect(NAV_ENTRIES).toHaveLength(15)
  })

  it('déclare une route par entrée, et aucune route d’écran hors de la table', () => {
    // Dans les deux sens : une entrée retirée de la table laisserait sa route sans rail, une route
    // ajoutée sans entrée serait un écran que personne ne trouve. Aucun des deux ne rougirait le test
    // qui parcourt la table.
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
    // Enfant de `_shell`, et l'accueil mis à part : c'est ce qui fait un écran du rail. Retrancher
    // une liste de chemins demanderait d'y penser à chaque route posée hors de la coquille, et
    // l'oubli ajouterait une entrée au rail sans rien faire rougir.
    const screens = Object.entries(router.routesByPath)
      .filter(([path, route]) => path !== '/' && route.id.startsWith('/_shell/'))
      .map(([path]) => path)
      .sort()

    expect(screens).toEqual(NAV_ENTRIES.map((entry) => entry.to).sort())
  })

  it('refuse une adresse qu’elle ne connaît pas', () => {
    expect(() => navEntry('/inconnu' as NavPath)).toThrow('/inconnu')
  })
})

describe('chaque route non livrée', () => {
  it.each(NAV_ENTRIES)('$to nomme le jalon $milestone', async ({ to, label, milestone }) => {
    stubSession({ permissions: [] })
    const router = createAppRouter(createMemoryHistory({ initialEntries: [to] }))
    render(<RouterProvider router={router} />)

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(label)
    expect(screen.getByText(new RegExp(`jalon ${milestone} `))).toBeInTheDocument()
  })
})
