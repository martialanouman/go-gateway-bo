import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { OTP_ACCOUNT, stubAdministration, WEBHOOK_SECRET } from '../../test/administration'

const WRITER: PermissionKey[] = ['accounts:read', 'accounts:write', 'customers:read']
const DLR: components['schemas']['Webhook'] = {
  id: 'webhook-dlr',
  eventType: 'dlr',
  url: 'https://client.example/dlr',
  status: 'active',
}

function open(initial: Parameters<typeof stubAdministration>[1] = {}) {
  const fetch = stubAdministration({ permissions: WRITER }, { accounts: [OTP_ACCOUNT], ...initial })
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
    await user.click(within(shown).getByRole('button', { name: 'J’ai copié le secret' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.body).not.toHaveTextContent(WEBHOOK_SECRET)
    await waitFor(() =>
      expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(WEBHOOK_SECRET),
    )
    expect(await screen.findByRole('cell', { name: 'https://client.example/dlr' })).toBeVisible()
  })

  it('warns that a rotated secret breaks deliveries until the customer installs it', async () => {
    const user = userEvent.setup()
    open({ webhooks: [DLR] })

    await user.click(
      await screen.findByRole('button', { name: 'Remplacer le secret du webhook DLR' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Remplacer le secret du webhook DLR ?',
    })

    expect(dialog).toHaveTextContent(
      'L’ancien secret cessera aussitôt de signer : le client rejettera les DLR tant qu’il n’aura pas installé le nouveau.',
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
})
