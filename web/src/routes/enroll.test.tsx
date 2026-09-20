import { _browserSupportsWebAuthnInternals } from '@simplewebauthn/browser'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { forgetChallenge, rememberChallenge } from '~/lib/session'
import { createAppRouter } from '~/router'
import { type AuthReplies, CHALLENGE, stubSession } from '../../test/session'

type SecondFactors = components['schemas']['SecondFactors']

/** Voir `mfa.test.tsx` : c'est la **plateforme** qu'on déclare, pas un module du produit. */
function stubWebAuthnSupport(supported: boolean) {
  vi.spyOn(_browserSupportsWebAuthnInternals, 'stubThis').mockReturnValue(supported)
}

beforeEach(forgetChallenge)
afterEach(forgetChallenge)
afterEach(() => vi.restoreAllMocks())

/**
 * L'écran d'enrôlement tel que l'application le monte, dans l'état exact où la connexion dépose le
 * premier administrateur : session ouverte au premier facteur, **aucun** second facteur, et le
 * challenge encore en mémoire.
 */
async function visitEnroll({
  path = '/enroll',
  replies = {} as AuthReplies,
  factors = {} as Partial<SecondFactors>,
} = {}) {
  rememberChallenge(CHALLENGE)
  stubSession(
    {
      permissions: [],
      elevated: false,
      secondFactors: { totp: false, passkeys: 0, recoveryCodesRemaining: 0, ...factors },
    },
    replies,
  )
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)
  // La sortie, présente sur tous les états résolus de l'écran — et sur aucun écran d'attente.
  await screen.findByRole('button', { name: 'Reprendre la connexion' })

  return { router, user: userEvent.setup() }
}

const authenticator = () => screen.getByRole('button', { name: /application d’authentification/i })
const passkey = () => screen.getByRole('button', { name: /clé d’accès/i })

describe('le choix de la voie', () => {
  it('présente la clé d’accès en premier quand l’appareil la connaît', async () => {
    stubWebAuthnSupport(true)
    await visitEnroll()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('second facteur')

    // §6.9 : « WebAuthn/passkey privilégié quand l'appareil le supporte ». Privilégié se lit dans
    // l'ordre de lecture, pas seulement dans une variante de bouton — un opérateur qui parcourt
    // l'écran au clavier rencontre la voie recommandée d'abord.
    const boutons = screen.getAllByRole('button')
    expect(boutons.indexOf(passkey())).toBeLessThan(boutons.indexOf(authenticator()))
  })

  it('garde l’application d’authentification offerte sur un poste sans clé d’accès', async () => {
    // jsdom n'implémente pas WebAuthn : c'est le poste sans authentificateur, rien de simulé.
    await visitEnroll()

    // Désactivée **et expliquée**, jamais masquée.
    expect(passkey()).toHaveAttribute('aria-disabled', 'true')
    const explication = passkey().getAttribute('aria-describedby')
    expect(document.getElementById(explication ?? '')).toHaveTextContent(/ce navigateur/i)

    // Et la détection de support n'a pas retiré la seule option qui reste : sans cela, l'écran
    // serait un cul-de-sac sur tout poste sans authentificateur de plateforme.
    expect(authenticator()).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('la garde de l’enrôlement', () => {
  it('renvoie à la connexion quand aucune session ne vit', async () => {
    rememberChallenge(CHALLENGE)
    stubSession({ status: 401 })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/enroll?redirect=%2Fbilling'] }),
    )
    render(<RouterProvider router={router} />)

    expect(await screen.findByLabelText(/E-mail/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: '/billing' })
  })

  it('renvoie à la connexion quand le challenge n’est plus en mémoire', async () => {
    // Sans challenge, la vérification du premier code serait refusée : l'écran enrôlerait un
    // facteur puis déposerait l'opérateur devant un refus certain. C'est ce que produit un
    // rechargement, puisque le challenge ne vit qu'en mémoire.
    stubSession({ permissions: [], elevated: false, secondFactors: { totp: false, passkeys: 0 } })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/enroll'] }))
    render(<RouterProvider router={router} />)

    expect(await screen.findByLabelText(/E-mail/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('renvoie au second facteur quand ce compte en détient déjà un', async () => {
    // Remplacer un facteur en place exige de présenter celui qu'on remplace (`TotpEnrollmentRequest`),
    // et cette step ne présente jamais de preuve : elle n'enrôle que le premier facteur. Le
    // remplacement arrive en step-029.
    const { router } = await visitEnroll({ factors: { totp: true } })

    expect(screen.getByLabelText(/Code à six chiffres/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })

  it('ne redemande rien à une session déjà élevée, et rejoint la destination', async () => {
    rememberChallenge(CHALLENGE)
    stubSession({ permissions: [] })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/enroll?redirect=%2Fbilling'] }),
    )
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Soldes & crédits/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/billing')
  })

  it('n’affirme rien des facteurs quand le BFF n’a pas rendu la session', async () => {
    // Une panne dégrade, elle ne déconnecte pas (invariant e) — mais elle ne dit pas non plus ce
    // que ce compte détient. Proposer un enrôlement à un opérateur parfaitement enrôlé rendrait
    // une **erreur** sous la forme d'un état vide, que le §1.9 sépare.
    rememberChallenge(CHALLENGE)
    stubSession({ status: 503 })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/enroll'] }))
    render(<RouterProvider router={router} />)

    // L'écran d'erreur est **celui du second facteur**, et c'est ce que la destination prouve : la
    // coquille rend le même titre et le même `GET /api/auth/me · 503` sur une adresse inconnue, si
    // bien qu'une assertion portée sur eux seuls passait déjà **sans que la route existe**. Mesuré.
    expect(await screen.findByRole('button', { name: 'Reprendre la connexion' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/mfa')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Impossible de vérifier la session',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('GET /api/auth/me · 503')
  })
})
