import { _browserSupportsWebAuthnInternals } from '@simplewebauthn/browser'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QRCodeSVG } from 'qrcode.react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { forgetChallenge, rememberChallenge } from '~/lib/session'
import { createAppRouter } from '~/router'
import {
  type AuthReplies,
  CHALLENGE,
  ENROLLMENT_SECRET,
  OTPAUTH_URI,
  RECOVERY_CODES,
  stubSession,
} from '../../test/session'

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

/** Le SVG que la bibliothèque a dessiné, atteint par le nom accessible que l'écran lui donne. */
async function qrCode() {
  const titre = await screen.findByTitle(/QR code/)
  const svg = titre.closest('svg')
  if (svg === null) throw new Error('le titre du QR ne vit dans aucun SVG')

  return svg
}

/**
 * Les modules du QR — le **second** chemin, le premier étant le fond.
 *
 * C'est le seul endroit où la valeur encodée est observable : `qrcode.react` ne la repose nulle
 * part dans le DOM. Comparer deux rendus de la même bibliothèque isole donc ce qui diffère.
 */
function modulesOf(svg: Element) {
  return svg.querySelectorAll('path')[1]?.getAttribute('d')
}

function modulesRenderedFor(element: ReactElement) {
  const hors = document.createElement('div')
  render(element, { container: hors })
  const svg = hors.querySelector('svg')
  if (svg === null) throw new Error('le témoin n’a dessiné aucun SVG')

  return modulesOf(svg)
}

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

describe('l’enrôlement d’une application d’authentification', () => {
  it('dessine le QR de l’URI que le serveur a rendue, et non d’une autre valeur', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())

    const dessine = modulesOf(await qrCode())

    // Le témoin est rendu par la **même** bibliothèque, avec les mêmes options : ce qui est comparé
    // est donc la valeur encodée, seule chose qui diffère.
    expect(dessine).toBe(
      modulesRenderedFor(<QRCodeSVG marginSize={4} size={200} value={OTPAUTH_URI} />),
    )
    // Et l'assertion au-dessus n'est pas vide : une autre valeur dessine d'autres modules. Sans
    // cette ligne, encoder la clé seule — ou n'importe quoi d'autre — passerait tout aussi bien.
    expect(dessine).not.toBe(
      modulesRenderedFor(<QRCodeSVG marginSize={4} size={200} value={ENROLLMENT_SECRET} />),
    )
  })

  it('le dessine à une taille qu’une caméra atteint, et non à celle du défaut', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())

    const svg = await qrCode()
    // 128 est le défaut de `qrcode.react`, et la bibliothèque le porte dans la géométrie du SVG
    // autant que dans ces attributs : une taille posée en CSS étirerait 128 px au lieu d'en
    // dessiner 200.
    expect(svg.getAttribute('width')).toBe('200')
    expect(svg.getAttribute('height')).toBe('200')
  })

  it('garde les deux couches du QR de couleurs distinctes', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())

    // Le défaut de la v1.0 : un carré noir de bout en bout. `qrcode.react` émet **deux** chemins —
    // le fond puis les modules —, et une règle qui les prenait tous les deux les peignait de la
    // même couleur. Ce que jsdom peut voir est que le produit n'a pas égalisé les deux couleurs
    // lui-même ; qu'aucune feuille ne les repeigne se lit dans le parcours Playwright, seul endroit
    // où le CSS est appliqué.
    const [fond, traits] = [...(await qrCode()).querySelectorAll('path')]
    expect(fond?.getAttribute('fill')).not.toBe(traits?.getAttribute('fill'))
  })

  it('montre la clé en clair pour un poste sans caméra, et la copie', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())

    expect(await screen.findByText(ENROLLMENT_SECRET)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Copier la clé' }))

    expect(await navigator.clipboard.readText()).toBe(ENROLLMENT_SECRET)
    // Un clic réussi qui ne change rien de perceptible n'est pas un retour : le presse-papiers ne
    // se relit pas à l'œil.
    expect(await screen.findByText('Clé copiée.')).toBeInTheDocument()
  })

  it('montre les dix codes de récupération, copiables et téléchargeables', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())

    const liste = await screen.findByRole('list', { name: 'Codes de récupération' })
    expect(within(liste).getAllByRole('listitem')).toHaveLength(RECOVERY_CODES.length)

    // Le rappel est écrit **avant** que l'opérateur quitte l'écran, pas après : il n'y a pas
    // d'après — aucune route ne rend ces codes une seconde fois.
    expect(screen.getByText(/Quitter cet écran sans les avoir enregistrés les perd/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Copier les codes' }))
    expect(await navigator.clipboard.readText()).toBe(RECOVERY_CODES.join('\n'))

    const fichier = screen.getByRole('link', { name: 'Télécharger les codes' })
    expect(fichier).toHaveAttribute('download', expect.stringContaining('.txt'))
    expect(decodeURIComponent(fichier.getAttribute('href') ?? '')).toContain(RECOVERY_CODES[9])
  })

  it('ne conduit à la vérification qu’une fois les codes reconnus enregistrés', async () => {
    const { router, user } = await visitEnroll()
    await user.click(authenticator())
    await screen.findByText(ENROLLMENT_SECRET)

    // Tant que rien n'est reconnu, aucune sortie vers la vérification : elle emporterait les codes
    // sans retour, et c'est le geste que l'écran doit ralentir.
    expect(screen.queryByRole('button', { name: 'Saisir le premier code' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'J’ai enregistré ces codes' }))
    await user.click(screen.getByRole('button', { name: 'Saisir le premier code' }))

    expect(await screen.findByLabelText(/Code à six chiffres/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })

  it('ne réaffiche pas les codes après un rechargement', async () => {
    const { user } = await visitEnroll()
    await user.click(authenticator())
    await screen.findByText(RECOVERY_CODES[0] ?? '')

    // Le rechargement, pour de bon : un document neuf, un routeur neuf, et le serveur qui porte
    // désormais le facteur — exactement ce que produit un F5 après l'enrôlement.
    cleanup()
    rememberChallenge(CHALLENGE)
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/enroll'] }))}
      />,
    )

    // La garde conduit au second facteur : un facteur est en place, et il se présente.
    expect(await screen.findByLabelText(/Code à six chiffres/)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain(RECOVERY_CODES[0])
    // Et rien n'en a été déposé dans le navigateur : chercher le texte à l'écran ne dirait rien
    // d'un stockage qui les garderait sous une autre clé.
    const stockage = JSON.stringify([{ ...localStorage }, { ...sessionStorage }])
    expect(stockage).not.toContain(RECOVERY_CODES[0])
    expect(stockage).not.toContain(ENROLLMENT_SECRET)
  })

  it('rend le refus du serveur quand un facteur a été posé entre-temps', async () => {
    // La course : un second onglet a enrôlé pendant que celui-ci attendait. Le serveur rédige le
    // refus, et il vaut pour l'écran entier — cette step ne présente aucune preuve, donc aucun
    // champ ne peut le porter.
    const { user } = await visitEnroll({
      replies: {
        enroll: {
          status: 409,
          body: {
            code: 'mfa_already_enrolled',
            message:
              'Un second facteur est déjà en place sur ce compte. Le remplacer exige de présenter celui qui est en place.',
          },
        },
      },
    })

    await user.click(authenticator())

    expect(await screen.findByRole('alert')).toHaveTextContent('déjà en place sur ce compte')
    expect(screen.queryByText(ENROLLMENT_SECRET)).toBeNull()
  })
})

describe('l’enregistrement d’une clé d’accès', () => {
  it('dit en français que la cérémonie n’a pas abouti, plutôt que le message de la bibliothèque', async () => {
    // Le poste **connaît** les clés d'accès ; jsdom n'a pas `navigator.credentials`, donc la
    // cérémonie de la bibliothèque échoue pour de bon.
    stubWebAuthnSupport(true)
    const { user } = await visitEnroll()

    await user.click(passkey())

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent('La clé d’accès n’a pas été enregistrée')
    expect(refus.textContent ?? '').not.toMatch(/[Ee]rror|not allowed|browser does/)
  })
})
