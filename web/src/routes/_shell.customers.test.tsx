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
  RESELLERS,
  stubAdministration,
} from '../../test/administration'

type Customer = components['schemas']['Customer']

const READER: PermissionKey[] = ['customers:read', 'groups:read']
const WRITER: PermissionKey[] = [...READER, 'customers:write']

function open(
  permissions: PermissionKey[],
  {
    entry = '/customers',
    customers = [ACME],
    customerPageSize,
    replies = {},
  }: {
    entry?: string
    customers?: Customer[]
    customerPageSize?: number
    replies?: AdministrationReplies
  } = {},
) {
  const fetch = stubAdministration(
    { permissions },
    { customers, ...(customerPageSize === undefined ? {} : { customerPageSize }) },
    replies,
  )
  render(
    <RouterProvider router={createAppRouter(createMemoryHistory({ initialEntries: [entry] }))} />,
  )
  return fetch
}

function customerReads(fetch: ReturnType<typeof stubAdministration>) {
  return fetch.mock.calls
    .map(([request]) => new URL((request as Request).url))
    .filter((url) => url.pathname === '/api/customers')
}

describe('the customers screen', () => {
  it('reads its filters from the address, sends them, and names the group', async () => {
    const fetch = open(READER, { entry: `/customers?status=active&groupId=${RESELLERS.id}` })

    expect(await screen.findByRole('cell', { name: ACME.name })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: RESELLERS.name })).toBeInTheDocument()
    const sent = customerReads(fetch).at(-1)
    expect(sent?.searchParams.get('status')).toBe('active')
    expect(sent?.searchParams.get('groupId')).toBe(RESELLERS.id)
    expect(screen.getByRole('combobox', { name: 'Statut' })).toHaveTextContent('active')
  })

  it('ignores a status the contract does not know', async () => {
    const fetch = open(READER, { entry: '/customers?status=supprime' })

    await screen.findByRole('cell', { name: ACME.name })
    expect(customerReads(fetch).at(-1)?.searchParams.has('status')).toBe(false)
  })

  it('adds the next page on demand, with the cursor the previous one gave', async () => {
    const user = userEvent.setup()
    const second = { ...ACME, id: 'c2', name: 'Bêta Mobile' }
    const third = { ...ACME, id: 'c3', name: 'Gamma SMS' }
    const fetch = open(READER, { customers: [ACME, second, third], customerPageSize: 2 })

    await screen.findByRole('cell', { name: second.name })
    expect(screen.queryByRole('cell', { name: third.name })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Afficher les suivants' }))

    expect(await screen.findByRole('cell', { name: third.name })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: ACME.name })).toBeInTheDocument()
    expect(customerReads(fetch).at(-1)?.searchParams.get('cursor')).toBe('2')
    expect(screen.queryByRole('button', { name: 'Afficher les suivants' })).not.toBeInTheDocument()
  })

  it('writes a filter chosen in the list to the address, and sends it', async () => {
    const user = userEvent.setup()
    const fetch = open(READER, {
      customers: [ACME, { ...ACME, id: 'c2', name: 'Bêta Mobile', groupId: undefined }],
    })

    await screen.findByRole('cell', { name: 'Bêta Mobile' })
    await user.click(screen.getByRole('combobox', { name: 'Groupe' }))
    await user.click(await screen.findByRole('option', { name: RESELLERS.name }))

    await waitFor(() =>
      expect(screen.queryByRole('cell', { name: 'Bêta Mobile' })).not.toBeInTheDocument(),
    )
    expect(customerReads(fetch).at(-1)?.searchParams.get('groupId')).toBe(RESELLERS.id)

    await user.click(screen.getByRole('combobox', { name: 'Statut' }))
    await user.click(await screen.findByRole('option', { name: 'suspended' }))
    await screen.findByRole('heading', { level: 2, name: 'Aucun client trouvé' })
    expect(customerReads(fetch).at(-1)?.searchParams.get('status')).toBe('suspended')

    await user.click(screen.getByRole('combobox', { name: 'Statut' }))
    await user.click(await screen.findByRole('option', { name: 'Tous les statuts' }))
    await user.click(screen.getByRole('combobox', { name: 'Groupe' }))
    await user.click(await screen.findByRole('option', { name: 'Tous les groupes' }))
    expect(await screen.findByRole('cell', { name: 'Bêta Mobile' })).toBeInTheDocument()
  })

  it('disables and explains creation for an operator who only reads customers', async () => {
    open(READER)

    const create = await screen.findByRole('button', { name: 'Nouveau client' })
    expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(create).toHaveAccessibleDescription(/customers:write/)
  })

  it('creates a customer, which appears in the list, and gives focus back to the title', async () => {
    const user = userEvent.setup()
    open(WRITER)

    await screen.findByRole('cell', { name: ACME.name })
    await user.click(screen.getByRole('button', { name: 'Nouveau client' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau client' })
    await user.type(within(dialog).getByLabelText('Nom'), 'Delta Pro')
    await user.click(within(dialog).getByRole('combobox', { name: 'Groupe' }))
    await user.click(await screen.findByRole('option', { name: RESELLERS.name }))
    await user.click(within(dialog).getByRole('button', { name: 'Créer le client' }))

    expect(await screen.findByText('Delta Pro est créé.')).toBeInTheDocument()
    const created = await screen.findByRole('cell', { name: 'Delta Pro' })
    expect(
      within(created.closest('tr') as HTMLElement).getByText(RESELLERS.name),
    ).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: 'Delta Pro' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toHaveFocus(),
    )
  })

  it('places a refusal on the name under its field, not in a banner', async () => {
    const user = userEvent.setup()
    const refusal = 'Refus de la passerelle, sous le nom.'
    open(WRITER, {
      replies: {
        'POST /api/customers': {
          status: 422,
          body: {
            code: 'validation_error',
            message: refusal,
            errors: [{ field: 'name', message: refusal }],
          },
        },
      },
    })

    await screen.findByRole('cell', { name: ACME.name })
    await user.click(screen.getByRole('button', { name: 'Nouveau client' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau client' })
    const name = within(dialog).getByLabelText('Nom')
    await user.type(name, 'Delta Pro')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le client' }))

    await waitFor(() => expect(name).toHaveAccessibleDescription(new RegExp(refusal)))
    expect(dialog.querySelector('.form-refusal')).toBeNull()
  })

  it('says how to create the first customer when there is none, and lets the dialog be cancelled', async () => {
    const user = userEvent.setup()
    open(WRITER, { customers: [] })

    await screen.findByRole('heading', { level: 2, name: 'Aucun client pour l’instant' })
    const creates = screen.getAllByRole('button', { name: 'Nouveau client' })
    expect(creates).toHaveLength(2)
    await user.click(creates[1] as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau client' })
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says the filters are too narrow, and resets them', async () => {
    const user = userEvent.setup()
    open(READER, { entry: '/customers?status=closed' })

    await screen.findByRole('heading', { level: 2, name: 'Aucun client trouvé' })
    await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))

    expect(await screen.findByRole('cell', { name: ACME.name })).toBeInTheDocument()
  })

  it('shows an unavailable gateway as an error to retry', async () => {
    const user = userEvent.setup()
    const fetch = open(READER, {
      replies: {
        'GET /api/customers': {
          status: 503,
          body: { code: 'bff_upstream_unreachable', message: 'La passerelle n’a pas pu répondre.' },
        },
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Les clients n’ont pas pu être chargés')
    const before = customerReads(fetch).length
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(customerReads(fetch).length).toBe(before + 1))
  })
})

describe('the groups screen, towards customers', () => {
  it('links each group to its customers', async () => {
    stubAdministration({ permissions: ['groups:read', 'customers:read'] })
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/groups'] }))}
      />,
    )

    const link = await screen.findByRole('link', { name: 'Voir les clients' })
    expect(link).toHaveAttribute('href', `/customers?groupId=${RESELLERS.id}`)
  })

  it('disables and explains the link without customers:read', async () => {
    stubAdministration({ permissions: ['groups:read'] })
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/groups'] }))}
      />,
    )

    const blocked = await screen.findByRole('button', { name: 'Voir les clients' })
    expect(blocked).toHaveAccessibleDescription(/customers:read/)
  })
})
