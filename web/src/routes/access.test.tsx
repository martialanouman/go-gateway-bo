import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAccessToken, peekAccessToken } from '~/lib/session'
import { createAppRouter } from '~/router'

beforeEach(forgetAccessToken)
afterEach(forgetAccessToken)

const LINK_REFUSAL = "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."
const VALID_PASSWORD = 'Un-mot-de-passe1!'

type Reply = { readonly status: number; readonly body?: unknown }

/**
 * Le BFF que cet écran rencontre : la route publique qu'il appelle, et `/auth/me` en 401 pour que
 * la connexion qui suit un succès s'affiche sans session — le même repli que `test/session.ts` pose
 * pour les écrans de la coquille.
 */
function stubAccess(reply: Reply = { status: 204 }) {
  const fetch = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url)
    const route = `${request.method} ${pathname}`

    if (route === 'POST /api/auth/access-link') {
      if (reply.body === undefined) return new Response(null, { status: reply.status })
      return Response.json(reply.body, { status: reply.status })
    }

    if (route === 'GET /api/auth/me') {
      return Response.json({ code: 'unauthenticated', message: 'Aucune session.' }, { status: 401 })
    }

    throw new Error(`appel réseau non déclaré : ${route}`)
  })

  vi.stubGlobal('fetch', fetch)

  return fetch
}

async function visitAccess(path: string, reply?: Reply) {
  const fetch = stubAccess(reply)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  render(<RouterProvider router={router} />)

  return { fetch, router, user: userEvent.setup() }
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = VALID_PASSWORD) {
  await user.type(await screen.findByLabelText('Mot de passe'), password)
  await user.type(screen.getByLabelText('Confirmer le mot de passe'), password)
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
}

describe('le fragment du lien d’accès', () => {
  it('efface le jeton de l’URL avant tout rendu, et le poste à l’envoi', async () => {
    const { fetch, router, user } = await visitAccess('/access#JETON')

    await screen.findByLabelText('Mot de passe')
    // Le fragment ne survit à aucun rendu — invariant (a) : ni log, ni URL, ni export.
    expect(router.state.location.hash).toBe('')
    expect(router.state.location.pathname).toBe('/access')

    await fillAndSubmit(user)

    const posted = fetch.mock.calls
      .map(([request]) => request)
      .find((request) => request.url.endsWith('/api/auth/access-link'))
    expect(await posted?.clone().json()).toEqual({ token: 'JETON', password: VALID_PASSWORD })
  })
})

describe('les règles de la saisie, avant le serveur', () => {
  it('refuse deux saisies qui diffèrent, sans appel réseau', async () => {
    const { fetch, user } = await visitAccess('/access#JETON')

    await user.type(await screen.findByLabelText('Mot de passe'), VALID_PASSWORD)
    await user.type(screen.getByLabelText('Confirmer le mot de passe'), 'Un-autre-mot-de-passe2!')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Les deux saisies diffèrent.')
    expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toEqual([])
  })

  it('nomme ce qui manque à un mot de passe trop simple, sans appel réseau', async () => {
    const { fetch, user } = await visitAccess('/access#JETON')

    await fillAndSubmit(user, 'motdepasselong')

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('une majuscule')
    expect(refus).toHaveTextContent('un chiffre')
    expect(fetch.mock.calls.filter(([request]) => request.method === 'POST')).toEqual([])
  })
})

describe('un lien sans jeton', () => {
  it('affiche le refus unique, sans formulaire', async () => {
    await visitAccess('/access')

    expect(await screen.findByText(LINK_REFUSAL)).toBeInTheDocument()
    expect(screen.queryByLabelText('Mot de passe')).toBeNull()
  })
})

describe('ce que le serveur rend à l’envoi', () => {
  it('un lien mort retire le formulaire et affiche le refus du serveur', async () => {
    const { user } = await visitAccess('/access#JETON', {
      body: { code: 'access_link_invalid', message: LINK_REFUSAL },
      status: 410,
    })

    await fillAndSubmit(user)

    expect(await screen.findByText(LINK_REFUSAL)).toBeInTheDocument()
    expect(screen.queryByLabelText('Mot de passe')).toBeNull()
  })

  it('une panne dégrade sans retirer le formulaire, contrairement à un lien mort', async () => {
    const { user } = await visitAccess('/access#JETON', {
      body: { code: 'overloaded', message: 'Le serveur vérifie déjà…' },
      status: 503,
    })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur vérifie déjà')
    // Invariant (e) : la panne dégrade, elle ne bloque pas — l'opérateur réessaie sans tout retaper.
    expect(screen.getByLabelText('Mot de passe')).toHaveValue(VALID_PASSWORD)
  })

  it('un succès efface le jeton et mène à l’avis de connexion', async () => {
    const { router, user } = await visitAccess('/access#JETON')

    await fillAndSubmit(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Connexion' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ passwordSet: true, redirect: undefined })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mot de passe enregistré. Connectez-vous pour configurer votre second facteur.',
    )
    expect(peekAccessToken()).toBeUndefined()
  })
})
