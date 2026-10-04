import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import {
  ACME,
  type AdministrationReplies,
  OTP_ACCOUNT,
  stubAdministration,
  WEBHOOK_SECRET,
} from '../../test/administration'

const WRITER: PermissionKey[] = ['accounts:read', 'accounts:write', 'customers:read']
const WEBHOOKS = `/api/accounts/${OTP_ACCOUNT.id}/webhooks`
const UNREACHABLE = {
  status: 503,
  body: { code: 'upstream_unreachable', message: 'Passerelle muette.' },
}
const DLR: components['schemas']['Webhook'] = {
  id: 'webhook-dlr',
  eventType: 'dlr',
  url: 'https://client.example/dlr',
  status: 'active',
}

function open(
  initial: Parameters<typeof stubAdministration>[1] = {},
  replies: AdministrationReplies = {},
) {
  const fetch = stubAdministration(
    { permissions: WRITER },
    { accounts: [OTP_ACCOUNT], ...initial },
    replies,
  )
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/accounts/${OTP_ACCOUNT.id}`] }),
  )
  render(<RouterProvider router={router} />)
  return { fetch, queryClient: router.options.context.queryClient }
}

describe('the account screen', () => {
  it('keeps the last open channel open, and says why', async () => {
    open({ accounts: [{ ...OTP_ACCOUNT, restEnabled: false }] })

    const cut = await screen.findByRole('button', { name: 'Couper SMPP' })

    expect(cut).toHaveAttribute('aria-disabled', 'true')
    expect(cut).toHaveAccessibleDescription(
      'Un compte garde au moins un canal : activez REST avant de couper SMPP.',
    )
  })

  it('names the missing permission before the business rule', async () => {
    stubAdministration(
      { permissions: ['accounts:read', 'customers:read'] },
      { accounts: [{ ...OTP_ACCOUNT, restEnabled: false }] },
    )
    render(
      <RouterProvider
        router={createAppRouter(
          createMemoryHistory({ initialEntries: [`/accounts/${OTP_ACCOUNT.id}`] }),
        )}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Couper SMPP' })).toHaveAccessibleDescription(
      'Modifier un compte demande accounts:write.',
    )
  })

  it('warns that refusing an SMPP operation cuts the live binds before it does', async () => {
    const user = userEvent.setup()
    open()

    await user.click(await screen.findByRole('button', { name: 'Refuser cancel_sm' }))
    const dialog = await screen.findByRole('dialog', { name: 'Refuser cancel_sm ?' })

    expect(dialog).toHaveTextContent('Les binds ouverts de ce compte seront coupés')
    await user.click(within(dialog).getByRole('button', { name: 'Refuser' }))

    expect(await screen.findByRole('button', { name: 'Autoriser cancel_sm' })).toBeInTheDocument()
  })

  it('shows a new webhook secret once, and never again once the dialog is closed', async () => {
    const user = userEvent.setup()
    const { queryClient } = open()

    await user.click(await screen.findByRole('button', { name: 'Nouveau webhook' }))
    const form = await screen.findByRole('dialog', { name: 'Nouveau webhook' })
    await user.type(
      within(form).getByRole('textbox', { name: 'URL' }),
      'https://client.example/dlr',
    )
    await user.click(within(form).getByRole('button', { name: 'Créer le webhook' }))

    const shown = await screen.findByRole('dialog', { name: 'Secret de signature du webhook' })
    expect(shown).toHaveTextContent(WEBHOOK_SECRET)
    await user.click(within(shown).getByRole('button', { name: 'Copier le secret' }))
    expect(await navigator.clipboard.readText()).toBe(WEBHOOK_SECRET)
    expect(shown).toHaveTextContent('Secret copié.')
    await user.click(within(shown).getByRole('button', { name: 'J’ai copié le secret' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body).not.toHaveTextContent(WEBHOOK_SECRET)
    await waitFor(() =>
      expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(WEBHOOK_SECRET),
    )
    expect(await screen.findByRole('cell', { name: 'https://client.example/dlr' })).toBeVisible()
  })

  it('warns that a rotated secret breaks deliveries, then shows the new one once', async () => {
    const user = userEvent.setup()
    const { queryClient } = open({ webhooks: [DLR] })

    await user.click(
      await screen.findByRole('button', { name: 'Remplacer le secret du webhook DLR' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remplacer le secret du webhook DLR ?',
    })

    expect(dialog).toHaveTextContent(
      'L’ancien secret cessera aussitôt de signer : le client rejettera les DLR tant qu’il n’aura pas installé le nouveau.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Remplacer' }))
    const shown = await screen.findByRole('dialog', { name: 'Secret de signature du webhook' })
    expect(shown).toHaveTextContent(WEBHOOK_SECRET)
    await user.click(within(shown).getByRole('button', { name: 'J’ai copié le secret' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body).not.toHaveTextContent(WEBHOOK_SECRET)
    await waitFor(() =>
      expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(WEBHOOK_SECRET),
    )
  })

  it('offers only the event types that have no webhook yet', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] })

    await user.click(await screen.findByRole('button', { name: 'Nouveau webhook' }))
    const form = await screen.findByRole('dialog', { name: 'Nouveau webhook' })

    expect(within(form).getByRole('combobox', { name: 'Événement' })).toHaveTextContent(
      'MO — SMS entrants',
    )
    await user.click(within(form).getByRole('combobox', { name: 'Événement' }))
    expect(screen.queryByRole('option', { name: /DLR/ })).toBeNull()
  })

  it('says the account could not be read, and leads back to the list', async () => {
    open({}, { [`GET /api/accounts/${OTP_ACCOUNT.id}`]: UNREACHABLE })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fiche du compte n’a pas pu être chargée',
    )
    expect(screen.getByRole('link', { name: 'Revenir à la liste des comptes' })).toBeVisible()
  })

  it('reads the account again when the operator retries', async () => {
    const user = userEvent.setup()
    const { fetch } = open({}, { [`GET /api/accounts/${OTP_ACCOUNT.id}`]: UNREACHABLE })

    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))

    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([request]) =>
            new URL((request as Request).url).pathname === `/api/accounts/${OTP_ACCOUNT.id}`,
        ),
      ).toHaveLength(2),
    )
  })

  it('names its customer and leads to the customer screen', async () => {
    open()

    expect(await screen.findByRole('link', { name: ACME.name })).toHaveAttribute(
      'href',
      `/customers/${ACME.id}`,
    )
  })

  it('cuts a channel and says so', async () => {
    const user = userEvent.setup()
    open()

    await user.click(await screen.findByRole('button', { name: 'Couper REST' }))

    expect(await screen.findByText('REST : coupé')).toBeInTheDocument()
    expect(await screen.findByText(`REST est coupé pour ${OTP_ACCOUNT.name}.`)).toBeInTheDocument()
  })

  it('says the webhooks could not be read, without hiding the rest of the account', async () => {
    const { fetch } = open({}, { [`GET ${WEBHOOKS}`]: UNREACHABLE })

    expect(
      await screen.findByRole('heading', { name: 'Les webhooks n’ont pas pu être chargés' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Couper SMPP' })).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([request]) => new URL((request as Request).url).pathname === WEBHOOKS,
        ),
      ).toHaveLength(2),
    )
  })

  it('disables a webhook and says so', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] })

    await user.click(await screen.findByRole('button', { name: 'Désactiver le webhook DLR' }))
    expect(await screen.findByText('Le webhook DLR est désactivé.')).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: 'Désactivé' })).toBeInTheDocument()
  })

  it('warns when the gateway refuses to change a webhook', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] }, { [`PATCH ${WEBHOOKS}/${DLR.id}`]: UNREACHABLE })

    await user.click(await screen.findByRole('button', { name: 'Désactiver le webhook DLR' }))

    expect(await screen.findByText('Passerelle muette.')).toBeInTheDocument()
  })

  it('deletes a webhook after naming where deliveries stop', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] })

    await user.click(await screen.findByRole('button', { name: 'Supprimer le webhook DLR' }))
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer le webhook DLR ?' })
    expect(dialog).toHaveTextContent(
      `La passerelle n’enverra plus les DLR de ce compte à ${DLR.url}.`,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))

    expect(
      await screen.findByRole('heading', { name: 'Aucun webhook pour l’instant' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: OTP_ACCOUNT.name })).toHaveFocus()
  })

  it('creates the webhook of the event type the operator picks', async () => {
    const user = userEvent.setup()
    open()

    await user.click(await screen.findByRole('button', { name: 'Nouveau webhook' }))
    const form = await screen.findByRole('dialog', { name: 'Nouveau webhook' })
    await user.click(within(form).getByRole('combobox', { name: 'Événement' }))
    await user.click(await screen.findByRole('option', { name: 'DLR — accusés de réception' }))
    await user.type(
      within(form).getByRole('textbox', { name: 'URL' }),
      'https://client.example/dlr',
    )
    await user.click(within(form).getByRole('button', { name: 'Créer le webhook' }))
    await user.click(await screen.findByRole('button', { name: 'J’ai copié le secret' }))

    expect(await screen.findByRole('cell', { name: 'DLR — accusés de réception' })).toBeVisible()
  })

  it('shows a refusal about the event type, which has no field to sit under', async () => {
    const user = userEvent.setup()
    const refusal =
      'Ce compte a déjà un webhook pour ce type d’événement. Supprimez-le, puis recréez-le.'
    open(
      {},
      {
        [`POST ${WEBHOOKS}`]: {
          status: 409,
          body: {
            code: 'conflict',
            message: refusal,
            errors: [{ field: 'eventType', message: refusal }],
          },
        },
      },
    )

    await user.click(await screen.findByRole('button', { name: 'Nouveau webhook' }))
    const form = await screen.findByRole('dialog', { name: 'Nouveau webhook' })
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://client.example/mo')
    await user.click(within(form).getByRole('button', { name: 'Créer le webhook' }))

    expect(await within(form).findByText(refusal)).toBeVisible()
  })
})
