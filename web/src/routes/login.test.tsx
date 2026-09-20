import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetChallenge, peekChallenge } from '~/lib/session'
import { createAppRouter } from '~/router'
import { type AuthReplies, CHALLENGE, stubSession } from '../../test/session'

beforeEach(forgetChallenge)
afterEach(forgetChallenge)

/**
 * L'écran de connexion tel que l'application le monte : vrai routeur, vrai `QueryClient`, vrai
 * client HTTP. Seul `fetch` est remplacé — rien du produit n'est injecté.
 */
async function visitLogin(path = '/login', replies: AuthReplies = {}) {
  stubSession({ status: 401 }, replies)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)
  // Le formulaire, et non le titre : l'écran d'attente de la garde porte le **même** titre, si bien
  // qu'attendre un `h1` rendait la main avant que le formulaire n'existe.
  await screen.findByLabelText(/Adresse professionnelle/)

  return { router, user: userEvent.setup() }
}

const email = () => screen.getByLabelText(/Adresse professionnelle/)
const password = () => screen.getByLabelText(/Mot de passe/)
const submit = () => screen.getByRole('button', { name: 'Se connecter' })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(email(), 'a.kouadio@example.test')
  await user.type(password(), 'un-mot-de-passe')
  await user.click(submit())
}

describe("l'écran de connexion", () => {
  it('énonce ce qu’il demande, sans rail ni barre supérieure', async () => {
    await visitLogin()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Connexion au tableau de bord',
    )
    // Hors de la coquille : aucune entrée de navigation ne mènerait ailleurs qu'à un refus.
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
    expect(email()).toBeRequired()
    expect(password()).toHaveAttribute('type', 'password')
  })

  it('mène au second facteur et retient le challenge hors de l’URL', async () => {
    const { router, user } = await visitLogin('/login?redirect=%2Fbilling')

    await fillAndSubmit(user)

    // Attendu **par son nom** : juste après l'envoi, l'écran de connexion est encore monté,
    // et un `findByRole('heading')` sans nom rend son titre à lui.
    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
    // La destination demandée traverse le second facteur : c'est elle qu'on rejouera.
    expect(router.state.location.search).toEqual({ redirect: '/billing' })

    expect(peekChallenge()).toBe(CHALLENGE)
    expect(router.state.location.searchStr).not.toContain(CHALLENGE)
    expect(document.body.innerHTML).not.toContain(CHALLENGE)
  })
})

describe('les refus du premier facteur', () => {
  it('rend le refus du serveur mot pour mot, sans dire lequel des deux a manqué', async () => {
    const { user } = await visitLogin('/login', {
      login: {
        status: 401,
        body: {
          code: 'invalid_credentials',
          message:
            "La connexion a été refusée : l'adresse ou le mot de passe ne correspond pas. Réessayez.",
        },
      },
    })

    await fillAndSubmit(user)

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent(
      "La connexion a été refusée : l'adresse ou le mot de passe ne correspond pas.",
    )
    // Le miroir bavard d'une garde qui se tait : l'écran ne doit pas nommer ce que le serveur
    // refuse de nommer (step-021).
    expect(refus).not.toHaveTextContent(/adresse inconnue|compte désactivé|mot de passe faux/i)
  })

  it('annonce la durée du verrouillage, qu’un refus muet ferait retenter', async () => {
    const { user } = await visitLogin('/login', {
      login: {
        status: 429,
        headers: { 'Retry-After': '240' },
        body: {
          code: 'too_many_attempts',
          message:
            'La connexion est temporairement bloquée après plusieurs échecs : réessayez dans 4 minutes.',
        },
      },
    })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('réessayez dans 4 minutes')
  })

  it('dit la panne et garde la saisie, plutôt que de vider l’écran', async () => {
    const { user } = await visitLogin('/login', {
      login: { status: 503, body: { code: 'overloaded', message: 'Le serveur vérifie déjà…' } },
    })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur vérifie déjà…')
    // Invariant (e) : la panne dégrade. Retaper une adresse après un 503 est ce qui fait fermer
    // l'onglet.
    expect(email()).toHaveValue('a.kouadio@example.test')
  })
})

describe('les erreurs champ par champ', () => {
  it('nomme le champ qui manque, et le relie à son message', async () => {
    const { user } = await visitLogin()

    await user.click(submit())

    const champ = email().closest('.ui-field')
    expect(email()).toHaveAttribute('aria-invalid', 'true')
    expect(within(champ as HTMLElement).getByRole('alert')).toHaveTextContent(
      'Cette adresse est requise',
    )
    // Le mot de passe manque aussi : les deux refus s'affichent, et non le premier seulement.
    expect(password()).toHaveAttribute('aria-invalid', 'true')
  })

  it('n’envoie rien au BFF tant qu’un champ manque', async () => {
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(email(), 'a.kouadio@example.test')
    await user.click(submit())

    const posts = fetch.mock.calls.filter(([request]) => request.method === 'POST')
    expect(posts).toEqual([])
  })

  it('efface le refus d’un champ dès qu’il est corrigé', async () => {
    const { user } = await visitLogin()

    await user.click(submit())
    expect(email()).toHaveAttribute('aria-invalid', 'true')

    await user.type(email(), 'a.kouadio@example.test')

    // Un refus qui survit à sa correction fait douter de tous les autres.
    expect(email()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('le clavier', () => {
  it('traverse le formulaire dans l’ordre lu et se valide sans souris', async () => {
    const { router, user } = await visitLogin()

    // L'écran n'a qu'une tâche, et le premier champ la porte : l'opérateur tape sans chercher.
    expect(email()).toHaveFocus()
    await user.type(email(), 'a.kouadio@example.test')

    await user.tab()
    expect(password()).toHaveFocus()
    await user.type(password(), 'un-mot-de-passe{Enter}')

    // Attendu **par son nom** : juste après l'envoi, l'écran de connexion est encore monté,
    // et un `findByRole('heading')` sans nom rend son titre à lui.
    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })
})
