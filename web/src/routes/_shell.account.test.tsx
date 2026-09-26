import { _browserSupportsWebAuthnInternals } from '@simplewebauthn/browser'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/lib/api.gen'
import { createAppRouter } from '~/router'
import {
  type AuthReplies,
  ENROLLMENT_SECRET,
  OPERATOR_NAME,
  stubAuthenticator,
  stubSession,
} from '../../test/session'

type SecondFactors = components['schemas']['SecondFactors']

afterEach(() => vi.restoreAllMocks())

async function visitAccount(factors: Partial<SecondFactors>, replies: AuthReplies = {}) {
  const fetch = stubSession({ permissions: [], secondFactors: factors }, replies)
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/account'] }))
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { level: 1, name: 'Mon compte' })

  return { fetch, router, user: userEvent.setup() }
}

const section = (name: string) => within(screen.getByRole('region', { name }))
const totpSection = () => section('Application d’authentification')
const passkeysSection = () => section('Clés d’accès')

async function removeButtonOf(name: string) {
  const cell = await passkeysSection().findByRole('cell', { name })
  const row = cell.closest('tr')
  if (row === null) throw new Error(`aucune ligne pour ${name}`)

  return within(row).getByRole('button', { name: 'Retirer' })
}

function posted(fetch: ReturnType<typeof stubSession>, path: string) {
  return fetch.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === 'POST' && request.url.endsWith(path))
}

describe('l’inventaire des facteurs', () => {
  it('dit ce que le compte détient, et est atteint par le nom de l’opérateur', async () => {
    stubSession({
      permissions: [],
      secondFactors: { totp: true, recoveryCodesRemaining: 7, passkeys: 2 },
    })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
    render(<RouterProvider router={router} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: OPERATOR_NAME }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Mon compte' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/account')
    expect(totpSection().getByText('Active')).toBeVisible()
    expect(section('Codes de récupération').getByText(/7 restants/)).toBeVisible()
    expect(await passkeysSection().findByRole('cell', { name: 'Clé 1' })).toBeVisible()
    expect(passkeysSection().getByRole('cell', { name: 'Clé 2' })).toBeVisible()
  })
})

describe('le retrait d’une clé d’accès', () => {
  it('désactive et explique le retrait du dernier facteur', async () => {
    const { fetch, user } = await visitAccount({
      totp: false,
      passkeys: 1,
      recoveryCodesRemaining: 0,
    })

    const retirer = await removeButtonOf('Clé 1')
    expect(retirer).toHaveAttribute('aria-disabled', 'true')
    expect(retirer).toHaveAccessibleDescription(/dernier second facteur/)

    await user.click(retirer)
    expect(fetch.mock.calls.some(([request]) => request.method === 'DELETE')).toBe(false)
  })

  it('laisse retirer une clé quand une autre reste, même sans application', async () => {
    await visitAccount({ totp: false, passkeys: 2 })

    expect(await removeButtonOf('Clé 1')).not.toHaveAttribute('aria-disabled')
  })

  it('retire une clé quand l’application reste en place', async () => {
    const { fetch, user } = await visitAccount({ totp: true, passkeys: 1 })

    const retirer = await removeButtonOf('Clé 1')
    expect(retirer).not.toHaveAttribute('aria-disabled')
    await user.click(retirer)

    await vi.waitFor(() =>
      expect(passkeysSection().queryByRole('cell', { name: 'Clé 1' })).toBeNull(),
    )
    const removal = fetch.mock.calls.find(([request]) => request.method === 'DELETE')?.[0]
    expect(removal?.url).toMatch(/\/api\/auth\/mfa\/webauthn\/passkeys\/passkey-1$/)
  })

  it('rend le refus du serveur tel qu’il l’a rédigé', async () => {
    const { user } = await visitAccount(
      { totp: true, passkeys: 1 },
      {
        unregister: {
          status: 409,
          body: {
            code: 'mfa_last_factor',
            message:
              "C'est le dernier second facteur de ce compte : le retirer en fermerait l'accès.",
          },
        },
      },
    )

    await user.click(await removeButtonOf('Clé 1'))

    expect(await screen.findByRole('alert')).toHaveTextContent('le retirer en fermerait l')
  })
})

describe('l’ajout d’une clé d’accès', () => {
  it('l’enregistre sous le nom saisi, qui paraît dans la table', async () => {
    vi.spyOn(_browserSupportsWebAuthnInternals, 'stubThis').mockReturnValue(true)
    stubAuthenticator()
    const { fetch, user } = await visitAccount({ totp: true, passkeys: 0 })

    await user.click(passkeysSection().getByRole('button', { name: 'Ajouter' }))
    await user.type(passkeysSection().getByLabelText(/Nom de la clé/), 'Portable')
    await user.click(passkeysSection().getByRole('button', { name: 'Enregistrer' }))

    expect(await passkeysSection().findByRole('cell', { name: 'Portable' })).toBeVisible()
    const finish = posted(fetch, '/api/auth/mfa/webauthn/register/finish')[0]
    expect(await finish?.clone().json()).toMatchObject({ name: 'Portable' })
  })
  it('rend le refus de l’enregistrement, et se referme sans rien enregistrer', async () => {
    vi.spyOn(_browserSupportsWebAuthnInternals, 'stubThis').mockReturnValue(true)
    stubAuthenticator()
    const { user } = await visitAccount(
      { totp: true, passkeys: 0 },
      {
        registered: {
          status: 400,
          body: { code: 'webauthn_ceremony_refused', message: 'La clé d’accès a été refusée.' },
        },
      },
    )

    await user.click(passkeysSection().getByRole('button', { name: 'Ajouter' }))
    await user.type(passkeysSection().getByLabelText(/Nom de la clé/), 'Portable')
    await user.click(passkeysSection().getByRole('button', { name: 'Enregistrer' }))

    expect(await passkeysSection().findByRole('alert')).toHaveTextContent('a été refusée')

    await user.click(passkeysSection().getByRole('button', { name: 'Annuler' }))
    expect(passkeysSection().getByRole('button', { name: 'Ajouter' })).toBeVisible()
    expect(passkeysSection().getByText('Aucune clé d’accès sur ce compte')).toBeVisible()
  })
})

describe('l’inventaire des clés, quand le BFF ne le rend pas', () => {
  it('dit l’échec et relit sur demande', async () => {
    const { fetch, user } = await visitAccount(
      { totp: true, passkeys: 1 },
      {
        passkeys: { status: 503, body: { code: 'overloaded', message: 'Le serveur est occupé.' } },
      },
    )
    const reads = () =>
      fetch.mock.calls.filter(([request]) =>
        request.url.endsWith('/api/auth/mfa/webauthn/passkeys'),
      ).length

    await user.click(await passkeysSection().findByRole('button', { name: 'Réessayer' }))

    expect(passkeysSection().getByText('Le serveur est occupé.')).toBeVisible()
    await vi.waitFor(() => expect(reads()).toBe(2))
  })
})

describe('l’application d’authentification', () => {
  it('remplace sur preuve, et confirme par la route de confirmation', async () => {
    const { fetch, router, user } = await visitAccount({ totp: true, passkeys: 0 })

    await user.click(totpSection().getByRole('button', { name: 'Remplacer' }))
    await user.click(screen.getByRole('radio', { name: 'Code de récupération' }))
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), 'a1b2c-3d4e5')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    await screen.findByText(ENROLLMENT_SECRET)
    expect(await posted(fetch, '/api/auth/mfa/totp/enroll')[0]?.clone().json()).toEqual({
      method: 'recovery_code',
      code: 'a1b2c-3d4e5',
    })

    await user.type(screen.getByLabelText(/Code à six chiffres/), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    await screen.findByRole('list', { name: 'Codes de récupération' })
    expect(await posted(fetch, '/api/auth/mfa/totp/confirm')[0]?.clone().json()).toEqual({
      code: '123456',
    })
    expect(posted(fetch, '/api/auth/mfa/verify')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'J’ai enregistré ces codes' }))
    expect(await totpSection().findByText('Active')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Codes de récupération' })).toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 0))
    const cached = JSON.stringify(
      router.options.context.queryClient
        .getMutationCache()
        .findAll()
        .map((m) => m.state),
    )
    expect(cached).not.toContain('a1b2c-3d4e5')
    expect(cached).not.toContain('123456')
    expect(cached).not.toContain(ENROLLMENT_SECRET)
  })

  it('rend le refus d’une preuve fausse, et ne montre aucun secret', async () => {
    const { user } = await visitAccount(
      { totp: true, passkeys: 0 },
      {
        enroll: {
          status: 409,
          body: {
            code: 'mfa_replacement_refused',
            message:
              "Ce second facteur n'a pas été accepté : celui qui est en place n'a pas été remplacé.",
          },
        },
      },
    )

    await user.click(totpSection().getByRole('button', { name: 'Remplacer' }))
    await user.type(screen.getByRole('textbox', { name: /^Code/ }), '000000')
    await user.click(screen.getByRole('button', { name: 'Continuer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('celui qui est en place')
    expect(screen.queryByText(ENROLLMENT_SECRET)).toBeNull()
  })

  it('rend le refus d’un code de confirmation faux, sans quitter l’écran', async () => {
    const { user } = await visitAccount(
      { totp: false, passkeys: 1 },
      {
        confirm: {
          status: 400,
          body: {
            code: 'mfa_code_refused',
            message:
              "Ce code n'a pas été accepté : la nouvelle application d'authentification n'est pas confirmée.",
          },
        },
      },
    )

    await user.click(totpSection().getByRole('button', { name: 'Ajouter' }))
    await screen.findByText(ENROLLMENT_SECRET)
    await user.type(screen.getByLabelText(/Code à six chiffres/), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("n'est pas confirmée")
    expect(screen.getByText(ENROLLMENT_SECRET)).toBeVisible()
  })

  it('ajoute une application sans preuve à un compte gardé par une clé d’accès', async () => {
    const { fetch, user } = await visitAccount({ totp: false, passkeys: 1 })

    expect(totpSection().getByText('Absente')).toBeVisible()
    await user.click(totpSection().getByRole('button', { name: 'Ajouter' }))
    await screen.findByText(ENROLLMENT_SECRET)
    expect(await posted(fetch, '/api/auth/mfa/totp/enroll')[0]?.clone().json()).toEqual({})

    await user.type(screen.getByLabelText(/Code à six chiffres/), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))
    await user.click(await screen.findByRole('button', { name: 'J’ai enregistré ces codes' }))

    expect(await totpSection().findByText('Active')).toBeVisible()
  })
})

describe('le clavier', () => {
  it('pose le focus sur chaque vue qui remplace la précédente, jusqu’au retour à l’inventaire', async () => {
    const { user } = await visitAccount({ totp: false, passkeys: 1 })

    await user.click(totpSection().getByRole('button', { name: 'Ajouter' }))
    expect(
      await screen.findByRole('heading', { name: 'Nouvelle application d’authentification' }),
    ).toHaveFocus()

    await user.type(screen.getByLabelText(/Code à six chiffres/), '123456')
    await user.click(screen.getByRole('button', { name: 'Vérifier' }))
    expect(await screen.findByRole('heading', { name: 'Codes de récupération' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'J’ai enregistré ces codes' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Mon compte' })).toHaveFocus()
  })

  it('rend le focus au titre quand le remplacement est abandonné', async () => {
    const { user } = await visitAccount({ totp: true, passkeys: 0 })

    await user.click(totpSection().getByRole('button', { name: 'Remplacer' }))
    await user.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Mon compte' })).toHaveFocus()
  })

  it('conduit le remplacement sans souris, du bouton à la preuve', async () => {
    const { fetch, user } = await visitAccount({ totp: true, passkeys: 0 })

    totpSection().getByRole('button', { name: 'Remplacer' }).focus()
    await user.keyboard('{Enter}')

    const code = await screen.findByRole('textbox', { name: /^Code/ })
    expect(code).toHaveFocus()
    await user.type(code, '123456{Enter}')

    await screen.findByText(ENROLLMENT_SECRET)
    expect(await posted(fetch, '/api/auth/mfa/totp/enroll')[0]?.clone().json()).toEqual({
      method: 'totp',
      code: '123456',
    })
  })
})
