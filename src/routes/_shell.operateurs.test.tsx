/**
 * L'écran des opérateurs, monté à son URL réelle.
 *
 * Deux risques y sont couverts : la liste doit dire ce qu'elle sait de chaque compte, et une
 * permission absente doit être **expliquée** plutôt que peinte en panne — sans même tenter la
 * lecture que le serveur refuserait.
 *
 * ## Ce qui n'est pas testé ici, et pourquoi — vérifié, pas supposé
 *
 * **Aucun chemin qui ouvre une modale.** `renderRoute` monte l'arbre de routes réel, donc `__root`,
 * qui rend un `<html>` — à l'intérieur de la `<div>` conteneur de Testing Library. Ouvrir une
 * surface flottante de Base UI dans ce document à deux racines fait **boucler le processus** :
 * la boucle est synchrone, si bien que `testTimeout` ne la coupe jamais et que la suite entière
 * doit être tuée. Constaté, puis borné par bisection : la même modale, avec les mêmes providers que
 * la coquille (`TooltipProvider`, `ToastProvider`) mais **sans le routeur**, s'ouvre et se saisit en
 * 86 ms.
 *
 * C'est donc un défaut du harnais, pas du produit — et la conclusion n'est pas d'inventer un test
 * qui contourne : la création d'un opérateur, l'affichage unique du mot de passe initial et le
 * bandeau de refus sont exercés **dans un vrai navigateur** par `e2e/connexion.spec.ts`, qui prolonge le parcours d'entrée dans la console plutôt que d'ouvrir un fichier de plus, ce que le
 * critère 1 de la DoD demande de toute façon. Le jour où `renderRoute` montera l'arbre sans
 * imbriquer un document, ces chemins pourront revenir ici.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPERATORS_QUERY_KEY } from '~/components/admin/api'
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
  permissions: ['operators:manage'],
  mfaCompleted: true,
}

const DIRECTORY = {
  operators: [
    {
      id: 'op-1',
      email: 'admin@example.test',
      displayName: 'Administratrice',
      status: 'active' as const,
      lastLoginAt: '2026-07-30T08:15:00.000Z',
      mfaEnrolled: true,
      roles: [{ id: 'role-1', name: 'super_admin' }],
    },
    {
      id: 'op-2',
      email: 'nouveau@example.test',
      displayName: 'Nouveau',
      status: 'disabled' as const,
      lastLoginAt: null,
      mfaEnrolled: false,
      roles: [],
    },
  ],
  roles: [
    { id: 'role-1', name: 'super_admin', isDefault: true },
    { id: 'role-2', name: 'auditor', isDefault: true },
  ],
}

function clientWith(operator: unknown, directory?: unknown) {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, operator)
  if (directory) client.setQueryData(OPERATORS_QUERY_KEY, directory)
  return client
}

/**
 * Un `fetch` qui **répond par chemin**, et non une doublure unique.
 *
 * Le premier jet répondait la même chose à tout le monde : `/auth/me` recevait donc la réponse
 * destinée à la création d'opérateur, `usePermission` lisait `permissions` sur un objet qui n'en a
 * pas, et le rendu levait à chaque tentative — la suite tournait alors sans fin, sans qu'aucun
 * message ne dise pourquoi. Les écrans font plusieurs appels ; une doublure qui l'ignore ment.
 */
function stubFetch(routes: Readonly<Record<string, { body: unknown; status?: number }>>) {
  const calls: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)

      const match = Object.entries(routes).find(([path]) => url.startsWith(path))
      if (!match)
        return new Response(JSON.stringify({ error: 'route absente du test' }), { status: 404 })

      return new Response(JSON.stringify(match[1].body), { status: match[1].status ?? 200 })
    }),
  )

  return calls
}

describe('l’écran des opérateurs', () => {
  it('montre ce qu’il sait de chaque compte', async () => {
    stubFetch({ '/api/auth/me': { body: ADMIN }, '/api/admin/operators': { body: DIRECTORY } })

    const screen = await renderRoute('/operateurs', {
      queryClient: clientWith(ADMIN, DIRECTORY),
    })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Opérateurs')
    expect(screen.getByText('nouveau@example.test')).toBeInTheDocument()
    // « jamais » et non un tiret : un compte qui n'a jamais servi est ce qu'on cherche à repérer.
    expect(screen.getByText('jamais')).toBeInTheDocument()
    expect(screen.getByText('aucun rôle')).toBeInTheDocument()
    // Les deux valeurs de l'enum du dépôt, verbatim : c'est ce qu'un exploitant grep.
    expect(screen.getByText('disabled')).toBeInTheDocument()
  })

  it('explique la permission manquante au lieu de peindre une panne', async () => {
    const calls = stubFetch({ '/api/auth/me': { body: { ...ADMIN, permissions: ['audit:read'] } } })

    const screen = await renderRoute('/operateurs', {
      queryClient: clientWith({ ...ADMIN, permissions: ['audit:read'] }),
    })

    expect(await screen.findByText(/operators:manage/)).toBeInTheDocument()
    // Et la lecture de l'annuaire n'est même pas tentée : un `403` peint en « chargement
    // interrompu » enverrait chercher une panne là où il manque une clé.
    expect(calls.filter((url) => url.startsWith('/api/admin'))).toEqual([])
  })
})
