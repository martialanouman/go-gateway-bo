/**
 * La frontière de session : trois rendus, et deux d'entre eux n'existaient pas.
 *
 * Une panne de `/auth/me` laissait une coquille vide, sans message et sans reprise ; l'attente
 * laissait passer un rendu à moitié peint. Les cinq états de contenu de la charte demandent le
 * contraire, et l'invariant (e) aussi : une panne dégrade la visualisation, elle ne la supprime pas.
 */

import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { renderComponent } from '~/test/render'
import { SessionBoundary } from './session-boundary'
import { useSessionStatus } from './session-gate'

afterEach(() => {
  vi.unstubAllGlobals()
})

function render(status: Parameters<typeof SessionBoundary>[0]['status'], retry = vi.fn()) {
  return {
    retry,
    ...renderComponent(
      <SessionBoundary label="Ouverture de la console" retry={retry} status={status}>
        <p>Le contenu gardé</p>
      </SessionBoundary>,
    ),
  }
}

/** Un écran gardé minimal : la frontière branchée sur le hook, comme les trois vrais. */
function GuardedScreen() {
  const { status, retry } = useSessionStatus()

  return (
    <SessionBoundary label="Ouverture" retry={retry} status={status}>
      <p>Le contenu gardé</p>
    </SessionBoundary>
  )
}

describe('branchée sur la session réelle', () => {
  it('refait la requête au lieu de recharger la page', async () => {
    // Un rechargement jetterait le cache, les toasts en cours et la position de défilement pour
    // reposer la seule question à laquelle il fallait répondre. Et il ne se teste pas : jsdom ne
    // navigue pas.
    const fetchMock = vi.fn(async () => new Response('nope', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getByRole, user } = renderComponent(<GuardedScreen />, {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    })

    const button = await vi.waitFor(() => getByRole('button', { name: /Réessayer/ }))
    const before = fetchMock.mock.calls.length

    await user.click(button)

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  })

  it('laisse passer une session déjà connue', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(OPERATOR_QUERY_KEY, {
      id: 'op-1',
      email: 'operatrice@example.test',
      displayName: 'Opératrice',
      permissions: [],
      mfaCompleted: true,
    })

    const { getByText } = renderComponent(<GuardedScreen />, { queryClient: client })

    expect(getByText('Le contenu gardé')).toBeInTheDocument()
  })
})

describe('SessionBoundary', () => {
  it('montre un squelette tant que la réponse n’est pas là', () => {
    const { getByRole, queryByText } = render('unknown')

    expect(getByRole('status')).toHaveAttribute('aria-busy', 'true')
    // Et surtout **pas** le contenu : le peindre avant de savoir qui regarde ferait apparaître un
    // écran gardé pour un visiteur qu'on est en train d'expulser.
    expect(queryByText('Le contenu gardé')).toBeNull()
  })

  it('dit la panne, et propose de refaire la requête', async () => {
    const { getByRole, user, retry } = render('unavailable')

    expect(getByRole('alert')).toBeInTheDocument()

    await user.click(getByRole('button', { name: /Réessayer/ }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('remplace le contenu gardé par l’état de panne', () => {
    // La redirection est décidée ailleurs — `sessionRedirect` rend `undefined` pour cet état — et ce
    // composant ne doit rien y ajouter. Un 502 le temps d'un redéploiement ne vaut pas une expulsion.
    //
    // Deux titres se sont succédé ici sans que les assertions changent : l'un promettait de
    // « retenir le contenu gardé », l'autre cherchait le titre du login sur un composant monté
    // **sans routeur**, qui ne peut structurellement jamais le rendre. Le titre dit désormais ce que
    // les assertions vérifient.
    const { queryByText, getByRole } = render('unavailable')

    expect(queryByText('Le contenu gardé')).toBeNull()
    expect(getByRole('alert')).toBeInTheDocument()
  })

  it('laisse passer une session décidée', () => {
    const { getByText } = render('complete')

    expect(getByText('Le contenu gardé')).toBeInTheDocument()
  })
})
