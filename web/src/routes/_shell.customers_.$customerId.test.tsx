import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import {
  ACME,
  type AdministrationReplies,
  RESELLERS,
  stubAdministration,
} from '../../test/administration'

const READER: PermissionKey[] = ['customers:read', 'groups:read']
const WRITER: PermissionKey[] = [...READER, 'customers:write']
const IMPACT = `GET /api/customers/${ACME.id}/suspension-impact`
const SUSPEND = `POST /api/customers/${ACME.id}/suspend`

function open(
  permissions: PermissionKey[],
  replies: AdministrationReplies = {},
  initial: Parameters<typeof stubAdministration>[1] = {},
) {
  const fetch = stubAdministration({ permissions }, initial, replies)
  render(
    <RouterProvider
      router={createAppRouter(createMemoryHistory({ initialEntries: [`/customers/${ACME.id}`] }))}
    />,
  )
  return fetch
}

function sent(fetch: ReturnType<typeof stubAdministration>, route: string) {
  return fetch.mock.calls.some(([request]) => {
    const { method, url } = request as Request
    return `${method} ${new URL(url).pathname}` === route
  })
}

// L'en-tête de la section et son état vide portent chacun le bouton ; le premier suffit.
async function registerButton() {
  return (
    await screen.findAllByRole('button', { name: 'Enregistrer un sender ID' })
  )[0] as HTMLElement
}

describe('the customer screen', () => {
  it('counts the accounts a suspension takes down before it leaves, then shows the customer suspended', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, {
      [IMPACT]: { status: 200, body: { accounts: 3, activeAccounts: 2 } },
    })

    await user.click(await screen.findByRole('button', { name: 'Suspendre' }))
    const dialog = await screen.findByRole('dialog', { name: `Suspendre ${ACME.name}` })

    expect(
      await within(dialog).findByText(/Ses 3 comptes, dont 2 actifs, sont suspendus avec lui/),
    ).toBeInTheDocument()
    expect(sent(fetch, SUSPEND)).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Suspendre le client' }))

    expect(await screen.findByRole('button', { name: 'Réactiver' })).toBeInTheDocument()
    expect(sent(fetch, SUSPEND)).toBe(true)
    expect(screen.getByRole('heading', { level: 1, name: ACME.name })).toHaveFocus()
  })

  it('refuses to suspend while the impact cannot be read', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, {
      [IMPACT]: {
        status: 503,
        body: { code: 'upstream_unreachable', message: 'Passerelle muette.' },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Suspendre' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Passerelle muette.')
    await user.click(within(dialog).getByRole('button', { name: 'Suspendre le client' }))

    expect(sent(fetch, SUSPEND)).toBe(false)
  })

  it('disables and explains every change without customers:write', async () => {
    open(READER)

    for (const name of ['Renommer', 'Suspendre', 'Enregistrer un sender ID']) {
      const control = (await screen.findAllByRole('button', { name }))[0]
      expect(control).toHaveAttribute('aria-disabled', 'true')
      expect(control).toHaveAccessibleDescription('Modifier un client demande customers:write.')
    }
  })

  it('places an address the customer already registered under its field', async () => {
    const user = userEvent.setup()
    const refusal = 'Ce client a déjà enregistré cette adresse.'
    open(WRITER, {
      [`POST /api/customers/${ACME.id}/sender-ids`]: {
        status: 409,
        body: {
          code: 'conflict',
          message: refusal,
          errors: [{ field: 'address', message: refusal }],
        },
      },
    })

    await user.click(await registerButton())
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Adresse' }), 'ACME')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    expect(
      await within(dialog).findByRole('textbox', { name: 'Adresse' }),
    ).toHaveAccessibleDescription(refusal)
    expect(dialog.querySelector('.form-refusal')).toBeNull()
  })

  it('says the accounts stay suspended before reactivating the customer', async () => {
    const user = userEvent.setup()
    open(WRITER, {}, { customers: [{ ...ACME, status: 'suspended' }] })

    await user.click(await screen.findByRole('button', { name: 'Réactiver' }))
    const dialog = await screen.findByRole('dialog', { name: `Réactiver ${ACME.name}` })
    expect(dialog).toHaveTextContent('Ses comptes restent suspendus')
    await user.click(within(dialog).getByRole('button', { name: 'Réactiver le client' }))

    expect(await screen.findByRole('button', { name: 'Suspendre' })).toBeInTheDocument()
  })

  it('renames the customer', async () => {
    const user = userEvent.setup()
    open(WRITER)

    await user.click(await screen.findByRole('button', { name: 'Renommer' }))
    const name = within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'Nom' })
    await user.clear(name)
    await user.type(name, 'Acme Mobile{Enter}')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acme Mobile' }),
    ).toBeInTheDocument()
  })

  it('detaches the customer from its group', async () => {
    const user = userEvent.setup()
    open(WRITER)

    expect(await screen.findByText(RESELLERS.name)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Changer de groupe' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Groupe' }))
    await user.click(await screen.findByRole('option', { name: 'Aucun groupe' }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Aucun groupe')).toBeInTheDocument()
  })

  it('approves a pending sender ID, then deletes it', async () => {
    const user = userEvent.setup()
    open(
      WRITER,
      {},
      {
        senders: [
          {
            id: 'sender-1',
            address: 'ACME',
            status: 'pending_carrier_approval',
            createdAt: '2026-09-30T08:00:00Z',
          },
        ],
      },
    )

    const row = (await screen.findByRole('cell', { name: 'ACME' })).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Approuver' }))
    expect(await within(row).findByRole('button', { name: 'Désactiver' })).toBeInTheDocument()
    expect(row).toHaveTextContent('active')

    await user.click(within(row).getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer ACME' })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le sender ID' }))

    expect(await screen.findByText('Aucun sender ID pour l’instant')).toBeInTheDocument()
  })

  it('names an unknown customer instead of an empty page', async () => {
    open(READER, {}, { customers: [] })

    expect(
      await screen.findByText('La fiche du client n’a pas pu être chargée'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revenir à la liste des clients' })).toBeInTheDocument()
  })

  it('registers a sender ID, which appears awaiting approval', async () => {
    const user = userEvent.setup()
    open(WRITER)

    await user.click(await registerButton())
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Adresse' }), 'ACME{Enter}')

    const row = (await screen.findByRole('cell', { name: 'ACME' })).closest('tr') as HTMLElement
    expect(row).toHaveTextContent('pending_carrier_approval')
    expect(within(row).getByRole('button', { name: 'Approuver' })).toBeInTheDocument()
  })

  it('announces a sender ID the gateway refused to change', async () => {
    const user = userEvent.setup()
    open(
      WRITER,
      {
        [`PATCH /api/customers/${ACME.id}/sender-ids/sender-1`]: {
          status: 503,
          body: { code: 'upstream_unreachable', message: 'Passerelle muette.' },
        },
      },
      {
        senders: [
          { id: 'sender-1', address: 'ACME', status: 'active', createdAt: '2026-09-30T08:00:00Z' },
        ],
      },
    )

    await user.click(await screen.findByRole('button', { name: 'Désactiver' }))

    expect(await screen.findByText('Passerelle muette.')).toBeInTheDocument()
  })

  it('places a refused name under its field', async () => {
    const user = userEvent.setup()
    const refusal = 'Le nom est refusé.'
    open(WRITER, {
      [`PATCH /api/customers/${ACME.id}`]: {
        status: 422,
        body: {
          code: 'validation_error',
          message: refusal,
          errors: [{ field: 'name', message: refusal }],
        },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Renommer' }))
    const name = within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'Nom' })
    await user.type(name, ' Mobile{Enter}')

    await waitFor(() => expect(name).toHaveAccessibleDescription(refusal))
  })

  it('reads the customer and its sender IDs again on retry', async () => {
    const user = userEvent.setup()
    const unavailable = { status: 503, body: { code: 'upstream_unreachable', message: 'Muette.' } }
    const fetch = open(READER, {
      [`GET /api/customers/${ACME.id}`]: unavailable,
    })

    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) =>
          new URL((request as Request).url).pathname.endsWith(ACME.id),
        ),
      ).toHaveLength(2),
    )
  })

  it('reads the sender IDs again on retry', async () => {
    const user = userEvent.setup()
    const route = `GET /api/customers/${ACME.id}/sender-ids`
    const fetch = open(READER, {
      [route]: { status: 503, body: { code: 'upstream_unreachable', message: 'Muette.' } },
    })

    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) =>
          new URL((request as Request).url).pathname.endsWith('/sender-ids'),
        ),
      ).toHaveLength(2),
    )
  })
})
