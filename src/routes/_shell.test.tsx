/**
 * La garde de session sur la coquille — reportée de la step-022, branchée ici.
 *
 * Un `beforeLoad` sur la route de mise en page protège d'un coup **tous** les écrans qu'elle
 * enveloppe. L'alternative — une garde par écran — aurait tenu jusqu'au premier écran ajouté sans
 * elle, et cet écran-là aurait été le seul ouvert.
 *
 * ## Ce que cette garde est, et ce qu'elle n'est pas
 *
 * Elle **redirige**, elle ne protège pas. La protection vit dans le BFF : chaque handler revérifie
 * la session, et `requirePermission()` revérifie les droits (invariant c). Un opérateur qui
 * neutraliserait ce `beforeLoad` dans son navigateur verrait une coquille vide et se ferait refuser
 * chaque appel — c'est la propriété qui compte, et elle ne dépend pas de ce fichier.
 */

import { describe, expect, it } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient } from '~/test/render'
import { renderRoute } from '~/test/render-route'

function clientWith(operator: unknown) {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, operator)
  return client
}

describe('la garde de session', () => {
  it('renvoie un anonyme au login', async () => {
    const screen = await renderRoute('/trafic', { queryClient: clientWith(null) })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Connexion opérateur',
    )
  })

  it('renvoie au second facteur une session partielle', async () => {
    // **Le cas que la step-022 ne pouvait pas encore couvrir.** Une session dont le mot de passe est
    // passé mais pas le second facteur ne porte aucune permission : la laisser entrer afficherait
    // une console entièrement grisée, sans dire ce qui manque.
    const screen = await renderRoute('/trafic', {
      queryClient: clientWith({
        id: 'op-1',
        email: 'operatrice@example.test',
        displayName: 'Opératrice',
        permissions: [],
        mfaCompleted: false,
      }),
    })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Vérification en deux étapes',
    )
  })

  it('laisse entrer une session complète', async () => {
    const screen = await renderRoute('/trafic', {
      queryClient: clientWith({
        id: 'op-1',
        email: 'operatrice@example.test',
        displayName: 'Opératrice',
        permissions: ['connectors:read'],
        mfaCompleted: true,
      }),
    })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Trafic')
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument()
  })
})
