import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PendingScreen } from '~/components/pending-screen'
import { createAppRouter } from '~/router'
import { stubSession } from '../../test/session'
import { NAV_ENTRIES, NAV_GROUPS, type NavPath, navEntry, OFF_RAIL } from './navigation'

describe('the navigation table', () => {
  it('mirrors the five charter groups, plus administration', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      'Exploitation',
      'Clients',
      'Routage',
      'Conformité',
      'Facturation',
      'Administration',
    ])
    expect(NAV_ENTRIES).toHaveLength(17)
  })

  it('opens each administration screen on its own key alone', () => {
    expect(navEntry('/operators').anyOf).toEqual(['operators:manage'])
    expect(navEntry('/roles').anyOf).toEqual(['roles:manage'])
  })

  it('declares one route per entry, and no screen route outside the table', () => {
    // Dans les deux sens : une entrée retirée de la table laisserait sa route sans rail, une route
    // ajoutée sans entrée serait un écran que personne ne trouve. Aucun des deux ne rougirait le test
    // qui parcourt la table.
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
    // Enfant de `_shell` et absent d'`OFF_RAIL`, qui nomme les écrans atteints autrement : c'est ce
    // qui fait un écran du rail.
    const screens = Object.entries(router.routesByPath)
      .filter(
        ([path, route]) =>
          !(OFF_RAIL as readonly string[]).includes(path) && route.id.startsWith('/_shell/'),
      )
      .map(([path]) => path)
      .sort()

    expect(screens).toEqual(NAV_ENTRIES.map((entry) => entry.to).sort())
  })

  it('rejects an address it does not know', () => {
    expect(() => navEntry('/inconnu' as NavPath)).toThrow('/inconnu')
  })
})

describe('each undelivered route', () => {
  const pending = NAV_ENTRIES.flatMap(({ milestone, ...entry }) =>
    milestone === undefined ? [] : [{ ...entry, milestone }],
  )

  it.each(pending)('$to names milestone $milestone', async ({ to, label, milestone }) => {
    stubSession({ permissions: [] })
    const router = createAppRouter(createMemoryHistory({ initialEntries: [to] }))
    render(<RouterProvider router={router} />)

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(label)
    expect(screen.getByText(new RegExp(`jalon ${milestone} `))).toBeInTheDocument()
  })
})

describe('the pending screen', () => {
  it('refuses to announce a delivered screen as pending', () => {
    expect(() => render(<PendingScreen to="/operators" />)).toThrow('/operators est livré')
  })
})
