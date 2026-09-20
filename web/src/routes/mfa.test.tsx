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

/**
 * Le crochet que `@simplewebauthn` expose pour ses propres tests. C'est la **plateforme** qu'on
 * déclare, pas un module du produit qu'on remplace : jsdom n'implémente pas WebAuthn, et sans lui
 * aucun test ne pourrait voir le chemin ouvert.
 */
function stubWebAuthnSupport(supported: boolean) {
  // `stubThis` se **remplace**, il ne s'appelle pas : `browserSupportsWebAuthn()` rend
  // `stubThis(<calcul réel>)`, si bien que seul un espion change sa réponse.
  vi.spyOn(_browserSupportsWebAuthnInternals, 'stubThis').mockReturnValue(supported)
}

beforeEach(forgetChallenge)
afterEach(forgetChallenge)
// Sans quoi le poste resterait « compatible » pour les tests suivants, qui décrivent l'inverse.
afterEach(() => vi.restoreAllMocks())

/**
 * L'écran du second facteur tel que l'application le monte. La session est **ouverte et non
 * élevée**, et le challenge est en mémoire : c'est exactement l'état où la connexion le dépose.
 */
async function visitMfa(
  secondFactors: Partial<SecondFactors>,
  { path = '/mfa', replies = {} as AuthReplies } = {},
) {
  rememberChallenge(CHALLENGE)
  stubSession({ permissions: [], elevated: false, secondFactors }, replies)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)
  // La sortie, présente sur les **deux** états résolus de l'écran et sur aucun écran d'attente —
  // lequel porte le même titre que le challenge, et rendait donc la main trop tôt.
  await screen.findByRole('button', { name: 'Reprendre la connexion' })

  return { router, user: userEvent.setup() }
}

const code = () => screen.getByLabelText(/Code à six chiffres/)

describe('le challenge TOTP', () => {
  it('demande le code de l’application d’authentification', async () => {
    await visitMfa({ totp: true, passkeys: 0 })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second facteur')
    expect(code()).toBeRequired()
    // Six chiffres : le clavier numérique s'ouvre sur mobile, et le champ refuse le texte.
    expect(code()).toHaveAttribute('inputMode', 'numeric')
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
  })

  it('élève la session et rejoue la destination demandée', async () => {
    const { router, user } = await visitMfa(
      { totp: true, passkeys: 0 },
      { path: '/mfa?redirect=%2Fbilling' },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: /Soldes & crédits/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/billing')
  })

  it('reprend l’indice de dérive d’horloge, que le serveur ne peut plus donner', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      {
        replies: {
          verify: {
            status: 401,
            body: {
              code: 'invalid_second_factor',
              message:
                'Ce second facteur n’a pas été accepté. Le présenter à nouveau, ou reprendre la connexion depuis le début.',
            },
          },
        },
      },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    const refus = await screen.findByRole('alert')
    // Le refus du serveur, mot pour mot…
    expect(refus).toHaveTextContent('Ce second facteur n’a pas été accepté')
    // …et l'indice que step-035 lui a retiré, parce qu'il servait aussi la clé d'accès. Cet
    // écran-ci sait qu'il présente un code TOTP : lui seul peut le dire sans mentir.
    expect(refus).toHaveTextContent(/heure/i)
  })
})

describe('la clé d’accès', () => {
  it('reste visible et expliquée sur un poste qui ne la connaît pas', async () => {
    // jsdom n'implémente pas WebAuthn : c'est le poste sans lecteur, sans rien de simulé.
    await visitMfa({ totp: true, passkeys: 2 })

    const bouton = screen.getByRole('button', { name: /clé d’accès/i })
    // Désactivé **et expliqué**, jamais masqué : l'opérateur doit savoir que la voie existe et
    // pourquoi elle ne s'ouvre pas ici.
    expect(bouton).toHaveAttribute('aria-disabled', 'true')
    expect(bouton).toBeVisible()

    const explication = bouton.getAttribute('aria-describedby')
    expect(explication).not.toBeNull()
    expect(document.getElementById(explication ?? '')).toHaveTextContent(/ce navigateur/i)
  })

  it('n’est pas proposée quand le compte n’en a aucune', async () => {
    await visitMfa({ totp: true, passkeys: 0 })

    expect(screen.queryByRole('button', { name: /clé d’accès/i })).toBeNull()
  })
})

describe('un opérateur sans second facteur enrôlé', () => {
  it('atterrit sur un état qui nomme son jalon, et non sur un challenge impossible', async () => {
    await visitMfa({ totp: false, passkeys: 0, recoveryCodesRemaining: 0 })

    // Ni champ de code ni bouton de vérification : les deux mèneraient à un refus certain.
    expect(screen.queryByLabelText(/Code à six chiffres/)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/n’est pas encore livré/)
    expect(screen.getByText(/step-028/)).toBeInTheDocument()
    expect(screen.getByText(/jalon M1/)).toBeInTheDocument()
  })

  it('garde une sortie : la connexion se reprend depuis cet écran', async () => {
    const { router, user } = await visitMfa({ totp: false, passkeys: 0 })

    await user.click(screen.getByRole('button', { name: 'Reprendre la connexion' }))

    expect(await screen.findByLabelText(/Adresse professionnelle/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('les refus du second facteur', () => {
  it('annonce la durée du blocage plutôt que de laisser retenter', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      {
        replies: {
          verify: {
            status: 429,
            headers: { 'Retry-After': '300' },
            body: {
              code: 'too_many_attempts',
              message:
                'Le second facteur est temporairement bloqué après plusieurs essais : réessayez dans 5 minutes.',
            },
          },
        },
      },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('réessayez dans 5 minutes')
  })
})

describe('la cérémonie de clé d’accès', () => {
  it('dit en français qu’elle n’a pas abouti, plutôt que de rendre le message de la bibliothèque', async () => {
    // Le poste **connaît** les clés d'accès : c'est le crochet de test de `@simplewebauthn` qui le
    // déclare, et non un module du produit remplacé — la cérémonie elle-même reste celle de la
    // bibliothèque, et jsdom la fera échouer faute de `navigator.credentials`.
    stubWebAuthnSupport(true)
    const { user } = await visitMfa({ totp: false, passkeys: 1 })

    await user.click(screen.getByRole('button', { name: /clé d’accès/i }))

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('La clé d’accès n’a pas été présentée')
    // Ce que la bibliothèque aurait dit : de l'anglais, et un nom d'erreur DOM.
    expect(refus.textContent ?? '').not.toMatch(/[Ee]rror|not allowed|browser does/)
    // L'indice d'horloge ne suit **pas** ce chemin : c'est ce que step-035 a retiré du serveur
    // pour l'avoir servi aux trois méthodes.
    expect(refus).not.toHaveTextContent(/heure/i)
  })
})

describe('la panne muette', () => {
  it('nomme le statut quand le serveur n’a rédigé aucun refus', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      { replies: { verify: { status: 502 } } },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 502')
  })
})

describe('la garde du second facteur', () => {
  it('renvoie à la connexion quand aucune session ne vit', async () => {
    rememberChallenge(CHALLENGE)
    stubSession({ status: 401 })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/mfa?redirect=%2Fbilling'] }),
    )
    render(<RouterProvider router={router} />)

    expect(await screen.findByLabelText(/Adresse professionnelle/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    // La destination survit au détour : c'est elle qu'on rejouera après les deux facteurs.
    expect(router.state.location.search).toEqual({ redirect: '/billing' })
  })

  it('ne redemande pas un facteur déjà franchi, et rejoint la destination', async () => {
    // Le cas du retour en arrière : redemander un code à qui vient de le donner est la boucle que
    // la v1.0 a livrée.
    rememberChallenge(CHALLENGE)
    stubSession({ permissions: [] })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/mfa?redirect=%2Fbilling'] }),
    )
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Soldes & crédits/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/billing')
  })
})
