import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { components } from '~/lib/api.gen'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { ACME, type AdministrationReplies, stubAdministration } from '../../test/administration'

const WRITER: PermissionKey[] = ['accounts:read', 'accounts:write', 'customers:read']
const OTP: components['schemas']['SmppAccount'] = {
  id: 'account-otp',
  customerId: ACME.id,
  name: 'trafic-otp',
  status: 'active',
  smppEnabled: true,
  restEnabled: true,
  querySmEnabled: true,
  cancelSmEnabled: true,
  allowedBindTypes: 'trx',
  maxSessions: 1,
  createdAt: '2026-10-01T08:00:00Z',
}

function open(
  entry: string,
  replies: AdministrationReplies = {},
  initial: Parameters<typeof stubAdministration>[1] = { accounts: [OTP] },
) {
  const fetch = stubAdministration({ permissions: WRITER }, initial, replies)
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: [entry] }))} />,
  )
  return fetch
}

describe('the accounts screen', () => {
  it('opens the account screen from its name', async () => {
    const user = userEvent.setup()
    open('/accounts')

    await user.click(await screen.findByRole('link', { name: OTP.name }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Canaux' })).toBeInTheDocument()
  })

  it('names the customer of each account and links to it', async () => {
    open('/accounts')

    expect(await screen.findByRole('link', { name: ACME.name })).toHaveAttribute(
      'href',
      `/customers/${ACME.id}`,
    )
  })

  it('creates nothing outside a customer, and says where to go', async () => {
    open('/accounts')

    const create = await screen.findByRole('button', { name: 'Nouveau compte' })
    expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(create).toHaveAccessibleDescription(
      'Un compte se crée depuis les comptes d’un client : ouvrez-les depuis sa fiche.',
    )
  })

  it('creates an account for the customer of the filter', async () => {
    const user = userEvent.setup()
    open(`/accounts?customerId=${ACME.id}`)

    expect(
      await screen.findByRole('heading', { level: 1, name: `Comptes de ${ACME.name}` }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nouveau compte' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau compte' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nom' }), 'trafic-marketing{Enter}')

    expect(await screen.findByRole('cell', { name: 'trafic-marketing' })).toBeInTheDocument()
  })

  it('places a name the customer already uses under its field', async () => {
    const user = userEvent.setup()
    const refusal = 'Ce client a déjà un compte de ce nom. Choisissez-en un autre.'
    open(`/accounts?customerId=${ACME.id}`, {
      'POST /api/accounts': {
        status: 409,
        body: { code: 'conflict', message: refusal, errors: [{ field: 'name', message: refusal }] },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Nouveau compte' }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: 'Nom' })
    await user.type(name, 'trafic-otp{Enter}')

    await waitFor(() => expect(name).toHaveAccessibleDescription(refusal))
    expect(dialog.querySelector('.form-refusal')).toBeNull()
  })

  it('reads the accounts again on retry', async () => {
    const user = userEvent.setup()
    const fetch = open('/accounts', {
      'GET /api/accounts': {
        status: 503,
        body: { code: 'upstream_unreachable', message: 'Muette.' },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([request]) => new URL((request as Request).url).pathname === '/api/accounts',
        ),
      ).toHaveLength(2),
    )
  })

  it('adds the next page on demand', async () => {
    const user = userEvent.setup()
    const second = { ...OTP, id: 'account-2', name: 'trafic-2' }
    open('/accounts', {}, { accounts: [OTP, second], customerPageSize: 1 })

    await screen.findByRole('cell', { name: OTP.name })
    await user.click(screen.getByRole('button', { name: 'Afficher les suivants' }))

    expect(await screen.findByRole('cell', { name: second.name })).toBeInTheDocument()
  })
})
