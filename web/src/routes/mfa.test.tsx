import { _browserSupportsWebAuthnInternals } from '@simplewebauthn/browser'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { forgetChallenge, peekChallenge, rememberChallenge } from '~/lib/session'
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

    expect(await screen.findByLabelText(/E-mail/)).toBeInTheDocument()
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

    expect(await screen.findByLabelText(/E-mail/)).toBeInTheDocument()
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

describe('l’indice d’horloge et la clé d’accès', () => {
  it('ne suit pas le refus d’une cérémonie : c’est ce que step-035 a retiré du serveur', async () => {
    // Le refus vient du **serveur**, sur l'ouverture de la cérémonie, et passe donc par la même
    // rédaction que le refus d'un code TOTP. C'est là que l'indice se glisserait s'il était ajouté
    // sans regarder la méthode — et c'est ce chemin-là que le serveur servait à tort.
    stubWebAuthnSupport(true)
    const { user } = await visitMfa(
      { totp: false, passkeys: 1 },
      {
        replies: {
          assert: {
            status: 400,
            body: {
              code: 'no_passkey_enrolled',
              message:
                'Aucune clé d’accès n’est enregistrée sur ce compte. En enregistrer une, ou franchir le second facteur autrement.',
            },
          },
        },
      },
    )

    await user.click(screen.getByRole('button', { name: /clé d’accès/i }))

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('Aucune clé d’accès n’est enregistrée')
    // « Vérifier l'heure de l'application d'authentification » n'a aucun sens dans le geste de qui
    // vient de présenter une clé.
    expect(refus).not.toHaveTextContent(/heure/i)
  })
})

describe('quand le BFF ne rend pas la session', () => {
  it('dit la panne et la réessaie, au lieu d’annoncer un compte sans second facteur', async () => {
    // La garde laisse passer une session illisible — une panne dégrade, elle ne déconnecte pas.
    // L'écran ne doit rien affirmer des facteurs qu'il n'a pas pu lire : annoncer « aucun facteur »
    // à un opérateur parfaitement enrôlé rend une **erreur** sous la forme d'un état **vide**, que
    // le §1.9 sépare précisément.
    rememberChallenge(CHALLENGE)
    stubSession({ status: 503 })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/mfa'] }))
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Impossible de vérifier la session',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('GET /api/auth/me · 503')
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeVisible()

    // Et surtout : pas un mot sur ce que ce compte détient.
    expect(screen.queryByText(/n’a ni application d’authentification/)).toBeNull()
    expect(screen.queryByText(/step-028/)).toBeNull()
    // La sortie reste, comme sur les autres états.
    expect(screen.getByRole('button', { name: 'Reprendre la connexion' })).toBeVisible()
  })

  it('relit la session quand l’opérateur réessaie, et reprend le challenge', async () => {
    rememberChallenge(CHALLENGE)
    let enPanne = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        const { pathname } = new URL(request.url)
        if (pathname !== '/api/auth/me') throw new Error(`appel non déclaré : ${pathname}`)
        if (enPanne) return Response.json({ code: 't', message: 'Panne.' }, { status: 503 })

        return Response.json({
          operator: {
            id: '01960000-0000-7000-8000-000000000001',
            email: 'a@b.test',
            displayName: 'Awa',
          },
          permissions: [],
          elevated: false,
          secondFactors: { totp: true, recoveryCodesRemaining: 10, passkeys: 0 },
          absoluteExpiresAt: '2026-09-17T20:00:00Z',
        })
      }),
    )

    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/mfa'] }))}
      />,
    )
    await screen.findByRole('button', { name: 'Réessayer' })

    enPanne = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))

    // La panne levée, l'écran reprend son office : le challenge, et non l'annonce d'un compte nu.
    expect(await screen.findByLabelText(/Code à six chiffres/)).toBeInTheDocument()
  })
})

describe('l’indice d’horloge et la cause du refus', () => {
  it('ne suit pas un verrouillage : l’horloge n’y est pour rien', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      {
        replies: {
          verify: {
            status: 429,
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

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('réessayez dans 5 minutes')
    // « Vérifiez l'heure de votre téléphone » après « attendez cinq minutes » envoie régler une
    // horloge qui n'est pas en cause.
    expect(refus).not.toHaveTextContent(/heure/i)
  })

  it('ne suit pas une panne muette', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      { replies: { verify: { status: 502 } } },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('HTTP 502')
    expect(refus).not.toHaveTextContent(/heure/i)
  })
})

describe('la cérémonie de clé d’accès, une à la fois', () => {
  it('s’annonce occupée, plutôt que d’en ouvrir une par clic', async () => {
    // Chaque ouverture écrit un défi côté serveur, et la dernière périme les précédentes : une
    // cérémonie que l'opérateur validait échouerait alors sans qu'aucun écran ne le nomme.
    stubWebAuthnSupport(true)
    // L'ouverture reste **en vol** : c'est le serveur lent, et la seule fenêtre où le défaut vit.
    // En jsdom la cérémonie échoue en une microtâche, donc un décor qui répond ne laisse rien voir.
    const { user } = await visitMfa(
      { totp: false, passkeys: 1 },
      { replies: { assert: 'pending' } },
    )
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    const bouton = screen.getByRole('button', { name: /clé d’accès/i })
    await user.click(bouton)

    expect(bouton).toHaveAttribute('aria-busy', 'true')

    await user.click(bouton)
    await user.click(bouton)

    const ouvertures = fetch.mock.calls.filter(([request]) =>
      request.url.endsWith('/api/auth/mfa/webauthn/assert/begin'),
    )
    expect(ouvertures).toHaveLength(1)
  })
})

describe('la réduction de la destination, à son point d’appel', () => {
  it('ne suit pas une URL de schéma relatif collée dans le paramètre', async () => {
    // Même raison que sur `/login` : ici le renvoi part en `href`, donc en URL brute. Sans la
    // réduction câblée, un opérateur déjà élevé qui ouvre ce lien quitte le site avec la connexion
    // encore en tête.
    rememberChallenge(CHALLENGE)
    stubSession({ permissions: [] })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/mfa?redirect=%2F%2Failleurs.example'] }),
    )
    render(<RouterProvider router={router} />)

    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.href).not.toContain('ailleurs.example')
  })
})

describe('le code manquant', () => {
  it('nomme ce qui manque et n’envoie rien au BFF', async () => {
    const { user } = await visitMfa({ totp: true, passkeys: 0 })
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(code()).toHaveAttribute('aria-invalid', 'true')
    expect(within(code().closest('.ui-field') as HTMLElement).getByRole('alert')).toHaveTextContent(
      'Saisissez le code',
    )
    // `noValidate` en même temps : sans lui, le navigateur rendrait son propre message, dans sa
    // langue et hors charte, et la phrase française ci-dessus n'apparaîtrait jamais.
    expect(fetch.mock.calls.filter(([r]) => r.url.endsWith('/api/auth/mfa/verify'))).toEqual([])
  })

  it('efface le refus dès que le code est saisi', async () => {
    const { user } = await visitMfa({ totp: true, passkeys: 0 })

    await user.click(screen.getByRole('button', { name: 'Vérifier' }))
    expect(code()).toHaveAttribute('aria-invalid', 'true')

    await user.type(code(), '1')
    expect(code()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('le clavier, sur le second facteur', () => {
  it('pose le focus sur le code et se valide sans souris', async () => {
    const { router, user } = await visitMfa({ totp: true, passkeys: 0 })

    expect(code()).toHaveFocus()
    // Six chiffres et pas un de plus : le commentaire du champ l'affirmait sans que rien le tienne.
    expect(code()).toHaveAttribute('maxLength', '6')

    await user.type(code(), '123456{Enter}')

    await screen.findByRole('heading', { level: 1, name: /cockpit/i })
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('ce que l’élévation et la sortie laissent derrière', () => {
  it('oublie le challenge consommé', async () => {
    const { user } = await visitMfa({ totp: true, passkeys: 0 })

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))
    await screen.findByRole('heading', { level: 1, name: /cockpit/i })

    // Gardé, il rouvrirait ce formulaire sur un challenge **mort** si la session retombait non
    // élevée — le cul-de-sac que la garde existe pour empêcher.
    expect(peekChallenge()).toBeUndefined()
  })

  it('oublie challenge et session quand l’opérateur reprend la connexion', async () => {
    const { user } = await visitMfa({ totp: true, passkeys: 0 })
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }
    const lectures = () => fetch.mock.calls.filter(([r]) => r.url.endsWith('/api/auth/me')).length
    const avant = lectures()

    await user.click(screen.getByRole('button', { name: 'Reprendre la connexion' }))
    await screen.findByLabelText(/E-mail/)

    expect(peekChallenge()).toBeUndefined()
    expect(lectures()).toBeGreaterThan(avant)
  })

  it('reste une sortie même quand la déconnexion échoue', async () => {
    // `onSettled` et non `onSuccess` : rester bloqué ici parce que le serveur a tombé serait
    // exactement le cul-de-sac qu'on cherche à éviter.
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      { replies: { logout: { status: 500, body: { code: 'oops', message: 'Panne.' } } } },
    )

    await user.click(screen.getByRole('button', { name: 'Reprendre la connexion' }))

    expect(await screen.findByLabelText(/E-mail/)).toBeInTheDocument()
  })
})

describe('le refus serveur et ce qu’il décrit', () => {
  it('disparaît quand la validation cliente prend la main, puis quand le code est corrigé', async () => {
    const { user } = await visitMfa(
      { totp: true, passkeys: 0 },
      {
        replies: {
          verify: {
            status: 401,
            body: {
              code: 'invalid_second_factor',
              message: 'Ce second facteur n’a pas été accepté.',
            },
          },
        },
      },
    )

    await user.type(code(), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('n’a pas été accepté')

    await user.clear(code())
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(screen.queryByText(/n’a pas été accepté/)).toBeNull()
    expect(code()).toHaveAttribute('aria-invalid', 'true')

    await user.type(code(), '6')
    expect(screen.queryByText(/Saisissez le code/)).toBeNull()
  })
})

describe('un code qui n’est que des espaces', () => {
  it('est refusé ici plutôt qu’envoyé au BFF, comme un champ vide', async () => {
    // Sans le `.trim()` du schéma, une espace seule satisfait le `minLength: 1` du contrat et part
    // en vérification : le serveur la refuse en 401, et l'opérateur lit « ce second facteur n'a pas
    // été accepté » là où il fallait lire « saisissez le code ». C'est ce que step-027 tenait avec
    // son `code.trim() === ''`.
    const { user } = await visitMfa({ totp: true, passkeys: 0 })
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(code(), '   ')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(within(code().closest('.ui-field') as HTMLElement).getByRole('alert')).toHaveTextContent(
      'Saisissez le code',
    )
    expect(fetch.mock.calls.filter(([r]) => r.url.endsWith('/api/auth/mfa/verify'))).toEqual([])
  })
})
