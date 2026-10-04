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

async function openWebhooks(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: 'Webhooks MO/DLR' }))
}

describe('the account screen', () => {
  it('leads back to its customer through the breadcrumb of the top bar', async () => {
    open()

    // La silhouette d'attente a sa propre barre : on attend le titre avant de lire celle de l'écran.
    await screen.findByRole('heading', { level: 1, name: OTP_ACCOUNT.name })
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('heading', { level: 1 })).toHaveTextContent(OTP_ACCOUNT.name)
    const crumbs = within(banner).getByRole('navigation', { name: 'Fil d’Ariane' })
    expect(within(crumbs).getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      '/customers',
    )
    expect(await within(crumbs).findByRole('link', { name: ACME.name })).toHaveAttribute(
      'href',
      `/customers/${ACME.id}`,
    )
  })

  it('keeps the last open channel open, and says why', async () => {
    open({ accounts: [{ ...OTP_ACCOUNT, restEnabled: false }] })

    const smpp = await screen.findByRole('switch', { name: 'SMPP' })

    expect(smpp).toBeChecked()
    expect(smpp).toHaveAttribute('aria-disabled', 'true')
    expect(smpp).toHaveAccessibleDescription(
      /Un compte garde au moins un canal : activez REST avant de couper SMPP\./,
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

    expect(await screen.findByRole('switch', { name: 'SMPP' })).toHaveAccessibleDescription(
      /Modifier un compte demande accounts:write\.$/,
    )
  })

  it('warns that refusing an SMPP operation cuts the live binds before it does', async () => {
    const user = userEvent.setup()
    open()

    const cancelSm = await screen.findByRole('switch', { name: 'cancel_sm' })
    await user.click(cancelSm)
    const dialog = await screen.findByRole('dialog', { name: 'Refuser cancel_sm ?' })

    expect(dialog).toHaveTextContent('Les binds ouverts de ce compte seront coupés')
    expect(cancelSm).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Refuser' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'cancel_sm' })).not.toBeChecked())
  })

  it('leaves an SMPP operation as it was when the operator cancels', async () => {
    const user = userEvent.setup()
    const { fetch } = open()

    await user.click(await screen.findByRole('switch', { name: 'query_sm' }))
    const dialog = await screen.findByRole('dialog', { name: 'Refuser query_sm ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('switch', { name: 'query_sm' })).toBeChecked()
    expect(fetch.mock.calls.some(([request]) => (request as Request).method === 'PUT')).toBe(false)
  })

  it('names what is not delivered yet in the credentials and quotas tabs', async () => {
    const user = userEvent.setup()
    open()

    await user.click(await screen.findByRole('tab', { name: 'Identifiants' }))
    expect(
      await screen.findByRole('heading', { name: 'Les identifiants ne sont pas encore livrés' }),
    ).toBeVisible()
    expect(screen.getByRole('tabpanel')).toHaveTextContent(
      'Tant qu’ils n’existent pas, ce compte ne peut pas se lier.',
    )

    await user.click(screen.getByRole('tab', { name: 'Quotas & sessions' }))
    expect(
      await screen.findByRole('heading', {
        name: 'Les quotas et les sessions ne sont pas encore livrés',
      }),
    ).toBeVisible()
  })

  it('shows a new webhook secret once, and never again once the dialog is closed', async () => {
    const user = userEvent.setup()
    const { queryClient } = open()

    await openWebhooks(user)
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

    await openWebhooks(user)
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

    await openWebhooks(user)
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

    await user.click(await screen.findByRole('switch', { name: 'REST' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: 'REST' })).not.toBeChecked())
    expect(await screen.findByText(`REST est coupé pour ${OTP_ACCOUNT.name}.`)).toBeInTheDocument()
  })

  it('says the webhooks could not be read, and reads them again on retry', async () => {
    const user = userEvent.setup()
    const { fetch } = open({}, { [`GET ${WEBHOOKS}`]: UNREACHABLE })

    await openWebhooks(user)
    expect(
      await screen.findByRole('heading', { name: 'Les webhooks n’ont pas pu être chargés' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
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

    await openWebhooks(user)
    const delivery = await screen.findByRole('switch', { name: 'Webhook DLR actif' })
    expect(delivery).toBeChecked()
    await user.click(delivery)

    expect(await screen.findByText('Le webhook DLR est désactivé.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Webhook DLR actif' })).not.toBeChecked(),
    )
  })

  it('warns when the gateway refuses to change a webhook', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] }, { [`PATCH ${WEBHOOKS}/${DLR.id}`]: UNREACHABLE })

    await openWebhooks(user)
    await user.click(await screen.findByRole('switch', { name: 'Webhook DLR actif' }))

    expect(await screen.findByText('Passerelle muette.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Webhook DLR actif' })).toBeChecked()
  })

  it('deletes a webhook after naming where deliveries stop', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] })

    await openWebhooks(user)
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

    await openWebhooks(user)
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

    await openWebhooks(user)
    await user.click(await screen.findByRole('button', { name: 'Nouveau webhook' }))
    const form = await screen.findByRole('dialog', { name: 'Nouveau webhook' })
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://client.example/mo')
    await user.click(within(form).getByRole('button', { name: 'Créer le webhook' }))

    expect(await within(form).findByText(refusal)).toBeVisible()
  })
})
