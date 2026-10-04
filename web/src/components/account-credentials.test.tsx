import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import {
  type AdministrationReplies,
  CREDENTIAL_SECRET,
  OTP_ACCOUNT,
  stubAdministration,
} from '../../test/administration'

type Credential = components['schemas']['Credential']
type AccountSession = components['schemas']['AccountSession']

const CLIENTELE: PermissionKey[] = [
  'accounts:read',
  'customers:read',
  'credentials:read',
  'credentials:write',
  'credentials:rotate',
]
const CREDENTIALS = `/api/accounts/${OTP_ACCOUNT.id}/credentials`
const SESSIONS = `/api/accounts/${OTP_ACCOUNT.id}/sessions`
const SMPP: Credential = {
  id: 'credential-smpp',
  type: 'smpp_bind',
  systemId: 'acme01',
  status: 'active',
  lastUsedAt: '2026-10-04T09:41:02Z',
  graceExpiresAt: null,
  createdAt: '2026-09-01T08:00:00Z',
  rotatedAt: null,
}
const API_KEY: Credential = {
  id: 'credential-api',
  type: 'api_key',
  systemId: null,
  status: 'active',
  lastUsedAt: null,
  graceExpiresAt: null,
  createdAt: '2026-09-01T08:00:00Z',
  rotatedAt: null,
}
const BIND: AccountSession = {
  id: 'bind-1',
  bindType: 'trx',
  remoteAddr: '10.4.19.7:40122',
  connectedAt: '2026-10-04T09:00:00Z',
}

function open(
  initial: Parameters<typeof stubAdministration>[1] = {},
  replies: AdministrationReplies = {},
  permissions: PermissionKey[] = CLIENTELE,
) {
  const fetch = stubAdministration(
    { permissions },
    { accounts: [OTP_ACCOUNT], ...initial },
    replies,
  )
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/accounts/${OTP_ACCOUNT.id}`] }),
  )
  render(<RouterProvider router={router} />)
  return { fetch, queryClient: router.options.context.queryClient }
}

async function openCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: 'Identifiants' }))
}

function card(name: string) {
  return screen.getByRole('region', { name })
}

function sentTo(fetch: ReturnType<typeof stubAdministration>, method: string, path: string) {
  return fetch.mock.calls
    .map(([request]) => request as Request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path)
}

describe('the credentials of an SMPP account', () => {
  it('shows exactly two cards, and offers to create the one the gateway does not hold', async () => {
    const user = userEvent.setup()
    open({ credentials: [SMPP] })

    await openCredentials(user)
    await screen.findByText('acme01')

    expect(card('Identifiant SMPP')).toBeVisible()
    expect(within(card('Clé API')).getByText('Aucune clé API')).toBeVisible()
    expect(within(card('Clé API')).getByRole('button', { name: 'Créer la clé API' })).toBeEnabled()
    expect(within(card('Identifiant SMPP')).queryByRole('button', { name: /Créer/ })).toBeNull()
  })

  it('creates the API key after a confirmation, and shows it once', async () => {
    const user = userEvent.setup()
    const { fetch } = open({ credentials: [SMPP] })

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Créer la clé API' }))
    const dialog = await screen.findByRole('dialog', { name: 'Créer la clé API ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))

    const shown = await screen.findByRole('dialog', { name: 'Nouvelle clé API' })
    expect(shown).toHaveTextContent(CREDENTIAL_SECRET)
    expect(await sentTo(fetch, 'POST', CREDENTIALS)[0]?.clone().json()).toEqual({ type: 'api_key' })
  })

  it('says what to do when the API key already exists', async () => {
    const user = userEvent.setup()
    const refusal =
      'Ce compte a déjà une clé API, active ou révoquée : faites-la tourner pour obtenir une nouvelle clé.'
    open(
      {},
      {
        [`POST ${CREDENTIALS}`]: {
          status: 409,
          body: {
            code: 'conflict',
            message: refusal,
            errors: [{ field: 'type', message: refusal }],
          },
        },
      },
    )

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Créer la clé API' }))
    const dialog = await screen.findByRole('dialog', { name: 'Créer la clé API ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Créer' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('faites-la tourner')
  })

  it('places a taken system_id under its field', async () => {
    const user = userEvent.setup()
    const refusal =
      'Ce compte a déjà un identifiant SMPP, ou ce system_id appartient à un autre compte : faites tourner l’identifiant existant, ou choisissez un autre system_id.'
    open(
      {},
      {
        [`POST ${CREDENTIALS}`]: {
          status: 409,
          body: {
            code: 'conflict',
            message: refusal,
            errors: [{ field: 'systemId', message: refusal }],
          },
        },
      },
    )

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Créer l’identifiant SMPP' }))
    const form = await screen.findByRole('dialog', { name: 'Nouvel identifiant SMPP' })
    const systemId = within(form).getByRole('textbox', { name: /system_id/ })
    await user.type(systemId, 'acme01')
    await user.click(within(form).getByRole('button', { name: 'Créer' }))

    await waitFor(() =>
      expect(systemId).toHaveAccessibleDescription(/choisissez un autre system_id/),
    )
    expect(within(form).getAllByRole('alert')).toHaveLength(1)
  })

  it('reads the credentials again when the operator retries', async () => {
    const user = userEvent.setup()
    const { fetch } = open(
      { credentials: [SMPP] },
      {
        [`GET ${CREDENTIALS}`]: {
          status: 503,
          body: { code: 'upstream_unreachable', message: '' },
        },
      },
    )

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))

    await waitFor(() => expect(sentTo(fetch, 'GET', CREDENTIALS)).toHaveLength(2))
  })

  it('keeps every credential masked, with nothing to reveal', async () => {
    const user = userEvent.setup()
    open({ credentials: [SMPP, API_KEY] })

    await openCredentials(user)
    await screen.findByText('acme01')

    for (const name of ['Identifiant SMPP', 'Clé API']) {
      expect(within(card(name)).getByText('masqué')).toBeVisible()
      expect(
        within(card(name)).queryByRole('button', { name: /révéler|afficher|voir/i }),
      ).toBeNull()
    }
  })

  it('shows a new SMPP secret once, and never again once the dialog is closed', async () => {
    const user = userEvent.setup()
    const { fetch, queryClient } = open()

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Créer l’identifiant SMPP' }))
    const form = await screen.findByRole('dialog', { name: 'Nouvel identifiant SMPP' })
    await user.type(within(form).getByRole('textbox', { name: /system_id/ }), 'acme01')
    await user.click(within(form).getByRole('button', { name: 'Créer' }))

    const shown = await screen.findByRole('dialog', { name: 'Mot de passe de l’identifiant SMPP' })
    expect(shown).toHaveTextContent(CREDENTIAL_SECRET)
    expect(shown).toHaveTextContent('Ce secret ne sera plus jamais affiché.')
    await user.click(within(shown).getByRole('button', { name: 'J’ai copié le secret' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body).not.toHaveTextContent(CREDENTIAL_SECRET)
    await waitFor(() =>
      expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(
        CREDENTIAL_SECRET,
      ),
    )
    expect(JSON.stringify(queryClient.getQueryCache().getAll())).not.toContain(CREDENTIAL_SECRET)
    expect(await sentTo(fetch, 'POST', CREDENTIALS)[0]?.json()).toEqual({
      type: 'smpp_bind',
      systemId: 'acme01',
    })
    expect(await within(card('Identifiant SMPP')).findByText('acme01')).toBeVisible()
  })

  it('rotates with a 24-hour grace by default, which cuts no bind', async () => {
    const user = userEvent.setup()
    const { fetch } = open({ credentials: [SMPP], sessions: [BIND, { ...BIND, id: 'bind-2' }] })

    await openCredentials(user)
    await user.click(
      await screen.findByRole('button', { name: 'Faire tourner l’identifiant SMPP' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Faire tourner l’identifiant SMPP ?' })

    expect(within(dialog).getByRole('combobox', { name: 'Fenêtre de grâce' })).toHaveTextContent(
      '24 heures',
    )
    expect(dialog).toHaveTextContent(
      'L’ancien mot de passe restera accepté pendant 24 heures. Aucun bind ouvert ne sera coupé.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Faire tourner' }))

    await screen.findByRole('dialog', { name: 'Mot de passe de l’identifiant SMPP' })
    expect(await sentTo(fetch, 'POST', `${CREDENTIALS}/${SMPP.id}/rotate`)[0]?.json()).toEqual({
      gracePeriodSec: 86_400,
    })
  })

  it('counts the binds a rotation without grace will cut', async () => {
    const user = userEvent.setup()
    const { fetch } = open({ credentials: [SMPP], sessions: [BIND], activeBinds: 3 })

    await openCredentials(user)
    await user.click(
      await screen.findByRole('button', { name: 'Faire tourner l’identifiant SMPP' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Faire tourner l’identifiant SMPP ?' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Fenêtre de grâce' }))
    await user.click(await screen.findByRole('option', { name: 'Aucune' }))

    expect(dialog).toHaveTextContent(
      'L’ancien mot de passe sera refusé dès maintenant, et les 3 binds ouverts de ce compte seront coupés.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Faire tourner' }))

    await screen.findByRole('dialog', { name: 'Mot de passe de l’identifiant SMPP' })
    expect(await sentTo(fetch, 'POST', `${CREDENTIALS}/${SMPP.id}/rotate`)[0]?.json()).toEqual({
      gracePeriodSec: 0,
    })
  })

  it('never speaks of binds when rotating the API key', async () => {
    const user = userEvent.setup()
    open({ credentials: [API_KEY], sessions: [BIND] })

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Faire tourner la clé API' }))
    const dialog = await screen.findByRole('dialog', { name: 'Faire tourner la clé API ?' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Fenêtre de grâce' }))
    await user.click(await screen.findByRole('option', { name: 'Aucune' }))

    expect(dialog).toHaveTextContent('L’ancienne clé sera refusée dès le prochain appel REST.')
    expect(dialog).not.toHaveTextContent(/bind/i)
  })

  it('brings a revoked credential back with a rotation that carries no grace', async () => {
    const user = userEvent.setup()
    const { fetch } = open({ credentials: [{ ...SMPP, status: 'revoked' }] })

    await openCredentials(user)
    await user.click(
      await screen.findByRole('button', { name: 'Faire tourner l’identifiant SMPP' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Faire tourner l’identifiant SMPP ?' })

    expect(within(dialog).queryByRole('combobox', { name: 'Fenêtre de grâce' })).toBeNull()
    expect(dialog).toHaveTextContent(
      'Cet identifiant redeviendra actif avec un nouveau mot de passe. L’ancien restera refusé.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Faire tourner' }))

    await screen.findByRole('dialog', { name: 'Mot de passe de l’identifiant SMPP' })
    expect(await sentTo(fetch, 'POST', `${CREDENTIALS}/${SMPP.id}/rotate`)[0]?.json()).toEqual({})
  })

  it('counts the binds a revocation of the SMPP credential will cut', async () => {
    const user = userEvent.setup()
    open({ credentials: [SMPP], sessions: [BIND], activeBinds: 2 })

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Révoquer l’identifiant SMPP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Révoquer l’identifiant SMPP ?' })

    expect(dialog).toHaveTextContent('Les 2 binds ouverts de ce compte seront coupés.')
    await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(card('Identifiant SMPP')).findByText('Révoqué')).toBeVisible()
  })

  it('still revokes when the open binds cannot be counted, and says every bind will be cut', async () => {
    const user = userEvent.setup()
    const { fetch } = open(
      { credentials: [SMPP] },
      { [`GET ${SESSIONS}`]: { status: 503, body: { code: 'upstream_unreachable', message: '' } } },
    )

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Révoquer l’identifiant SMPP' }))
    const dialog = await screen.findByRole('dialog', { name: 'Révoquer l’identifiant SMPP ?' })

    expect(
      await within(dialog).findByText(/Tous les binds ouverts de ce compte seront coupés/),
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Révoquer' }))

    await waitFor(() =>
      expect(sentTo(fetch, 'DELETE', `${CREDENTIALS}/${SMPP.id}`)).toHaveLength(1),
    )
  })

  it('says that revoking the API key cuts no bind', async () => {
    const user = userEvent.setup()
    open({ credentials: [API_KEY], sessions: [BIND] })

    await openCredentials(user)
    await user.click(await screen.findByRole('button', { name: 'Révoquer la clé API' }))
    const dialog = await screen.findByRole('dialog', { name: 'Révoquer la clé API ?' })

    expect(dialog).toHaveTextContent('Tout appel REST avec cette clé sera refusé.')
    expect(dialog).toHaveTextContent('Aucun bind SMPP ne sera coupé.')
  })

  it('names the missing permission on each gesture', async () => {
    const user = userEvent.setup()
    open({ credentials: [SMPP] }, {}, ['accounts:read', 'customers:read', 'credentials:read'])

    await openCredentials(user)

    expect(
      await screen.findByRole('button', { name: 'Faire tourner l’identifiant SMPP' }),
    ).toHaveAccessibleDescription('Faire tourner un identifiant demande credentials:rotate.')
    expect(
      screen.getByRole('button', { name: 'Révoquer l’identifiant SMPP' }),
    ).toHaveAccessibleDescription('Créer ou révoquer un identifiant demande credentials:write.')
    expect(screen.getByRole('button', { name: 'Créer la clé API' })).toHaveAccessibleDescription(
      'Créer ou révoquer un identifiant demande credentials:write.',
    )
  })

  it('reads nothing without credentials:read, and says so', async () => {
    const user = userEvent.setup()
    const { fetch } = open({ credentials: [SMPP] }, {}, ['accounts:read', 'customers:read'])

    await openCredentials(user)

    expect(
      await screen.findByText('Lire les identifiants d’un compte demande credentials:read.'),
    ).toBeVisible()
    expect(sentTo(fetch, 'GET', CREDENTIALS)).toHaveLength(0)
  })
})
