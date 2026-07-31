/**
 * L'écran des rôles, monté à son URL réelle.
 *
 * Même partage que pour l'écran des opérateurs : ce qui n'ouvre pas de surface flottante se teste
 * ici, le reste dans un vrai navigateur (`e2e/connexion.spec.ts`, qui prolonge le parcours d'entrée dans la console plutôt que d'ouvrir un fichier de plus). La raison est écrite en tête de
 * `_shell.operateurs.test.tsx` — `renderRoute` monte un document à deux racines, et une modale de
 * Base UI y fait boucler le processus.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROLES_QUERY_KEY } from '~/components/admin/api'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient } from '~/test/render'
import { renderRoute } from '~/test/render-route'

afterEach(() => {
  vi.unstubAllGlobals()
})

const ADMIN = {
  id: 'op-1',
  email: 'admin@example.test',
  displayName: 'Administratrice',
  permissions: ['roles:manage'],
  mfaCompleted: true,
}

const ROLES = {
  roles: [
    {
      id: 'role-1',
      name: 'super_admin',
      description: 'Propriétaire de la plateforme',
      isDefault: true,
      permissions: ['operators:manage', 'roles:manage'],
      operatorCount: 2,
    },
    {
      id: 'role-2',
      name: 'support_n2',
      description: 'Support de second niveau',
      isDefault: false,
      permissions: ['sessions:read'],
      operatorCount: 0,
    },
  ],
}

function clientWith(operator: unknown, roles?: unknown) {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, operator)
  if (roles) client.setQueryData(ROLES_QUERY_KEY, roles)
  return client
}

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/auth/me')
        ? new Response(JSON.stringify(ADMIN), { status: 200 })
        : new Response(JSON.stringify(body), { status: 200 }),
    ),
  )
}

describe('l’écran des rôles', () => {
  it('distingue un rôle livré d’un rôle personnalisé, et dit qui les porte', async () => {
    stubFetch(ROLES)

    const screen = await renderRoute('/roles', { queryClient: clientWith(ADMIN, ROLES) })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Rôles')
    expect(screen.getByText('support_n2')).toBeInTheDocument()
    // L'origine décide de ce qui est possible — supprimer, renommer — et se lit donc dans la table,
    // pas seulement dans la modale.
    expect(screen.getByText('Livré avec le produit')).toBeInTheDocument()
    expect(screen.getByText('Personnalisé')).toBeInTheDocument()
  })

  it('explique la permission manquante au lieu de peindre une panne', async () => {
    stubFetch(ROLES)

    const screen = await renderRoute('/roles', {
      queryClient: clientWith({ ...ADMIN, permissions: ['audit:read'] }),
    })

    expect(await screen.findByText(/roles:manage/)).toBeInTheDocument()
  })
})
