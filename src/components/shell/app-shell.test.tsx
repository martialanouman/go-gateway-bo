/**
 * La coquille, et ce qu'elle doit garantir à un opérateur au clavier.
 *
 * Trois propriétés, dans l'ordre où elles comptent : les repères ARIA qui permettent de sauter au
 * contenu, le lien d'évitement **en première position**, et un rail dont les entrées reflètent les
 * permissions réelles.
 */

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { renderRoute } from '~/test/render-route'
import { NAV_ENTRIES, NAVIGATION } from './navigation'

function clientWithPermissions(permissions: readonly string[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })

  client.setQueryData(OPERATOR_QUERY_KEY, {
    id: 'op-1',
    email: 'operatrice@example.test',
    displayName: 'Opératrice',
    permissions,
    mfaCompleted: true,
  })

  return client
}

describe('AppShell — repères', () => {
  it('pose les trois repères que les lecteurs d’écran utilisent', async () => {
    // Par une **vraie route** : le rail rend des `Link` du routeur, et les monter hors routeur
    // testerait un composant que le produit n'utilise pas.
    const { getByRole } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(['customers:read']),
    })

    expect(getByRole('banner')).toBeInTheDocument()
    expect(getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument()
    expect(getByRole('main')).toBeInTheDocument()
  })

  it('met le lien d’évitement en **première** position focusable', async () => {
    // Un lien d'évitement qui arrive en troisième position ne sert plus à rien : il faut déjà avoir
    // traversé ce qu'il permettait d'éviter.
    //
    // L'assertion porte sur l'**ordre du document** plutôt que sur une tabulation simulée : dans cet
    // arbre complet — coquille, providers Base UI, dix-sept liens — `user.tab()` ne rend jamais la
    // main. Je n'ai pas trouvé pourquoi, et je préfère un test déterministe qui vérifie la bonne
    // propriété à un test qui bloque la suite. Le parcours clavier réel ira au e2e (step-026).
    const { container, getByRole } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(['customers:read']),
    })

    const focusable = container.ownerDocument.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )

    expect(focusable[0]).toBe(getByRole('link', { name: 'Aller au contenu' }))
  })

  it('rend l’écran de la route dans la zone principale', async () => {
    const { getByRole } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(['customers:read']),
    })

    expect(getByRole('main')).toHaveTextContent('Clients')
  })

  it('nomme l’opérateur connecté', async () => {
    const { getByText } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(['customers:read']),
    })

    expect(getByText('Opératrice')).toBeInTheDocument()
  })
})

describe('AppShell — le rail suit les permissions', () => {
  it('ne montre que les entrées que l’opérateur peut utiliser', async () => {
    const { getByRole, queryByRole } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(['customers:read', 'routes:read']),
    })

    expect(getByRole('link', { name: 'Clients' })).toBeInTheDocument()
    expect(getByRole('link', { name: 'Routes' })).toBeInTheDocument()

    // Masquée, et c'est l'unique exception à « désactivé et expliqué » : un rail plein d'entrées
    // mortes n'apprend rien, là où un bouton désactivé dans un écran dit quoi demander.
    expect(queryByRole('link', { name: 'Facturation' })).toBeNull()
  })

  it('montre tout à un super_admin', async () => {
    const { getAllByRole } = await renderRoute('/clients', {
      queryClient: clientWithPermissions(NAV_ENTRIES.map((entry) => entry.permission)),
    })

    // Le lien d'évitement en plus des entrées du rail.
    expect(getAllByRole('link')).toHaveLength(NAV_ENTRIES.length + 1)
  })

  it('marque l’entrée active depuis l’URL, jamais depuis un état local', async () => {
    // Deux sources finiraient par diverger, et c'est l'affichage qui mentirait, pas l'URL.
    const { getByRole } = await renderRoute('/routes', {
      queryClient: clientWithPermissions(['customers:read', 'routes:read']),
    })

    expect(getByRole('link', { name: 'Routes' })).toHaveAttribute('data-status', 'active')
    expect(getByRole('link', { name: 'Clients' })).not.toHaveAttribute('data-status', 'active')
  })

  it('ne montre aucune entrée tant que les permissions sont inconnues', async () => {
    // Rendre le rail complet « en attendant » le ferait se vider sous les yeux de l'opérateur.
    const empty = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { queryAllByRole } = await renderRoute('/clients', { queryClient: empty })

    expect(queryAllByRole('link', { name: /Clients|Routes|Facturation/ })).toHaveLength(0)
  })
})

describe('la carte de navigation', () => {
  it('couvre les six familles de la charte, dans l’ordre', () => {
    expect(NAVIGATION.map((group) => group.label)).toEqual([
      'Exploitation',
      'Clients',
      'Routage',
      'Conformité',
      'Facturation',
      'Administration',
    ])
  })

  it('ne déclare aucune entrée en double', () => {
    const paths = NAV_ENTRIES.map((entry) => entry.to)

    expect(new Set(paths).size).toBe(paths.length)
  })
})
