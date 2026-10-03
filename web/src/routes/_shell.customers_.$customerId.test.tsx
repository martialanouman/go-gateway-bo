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

describe('the customer screen', () => {
  it('counts the accounts a suspension takes down before it leaves, then shows the customer suspended', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, {
      [IMPACT]: { status: 200, body: { accounts: 3, activeAccounts: 1, closedAccounts: 1 } },
    })

    await user.click(await screen.findByRole('button', { name: 'Suspendre' }))
    const dialog = await screen.findByRole('dialog', { name: `Suspendre ${ACME.name} ?` })

    expect(
      await within(dialog).findByText(/Ses 3 comptes SMPP seront suspendus, dont 1 actif/),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      'Un compte fermé repassera suspendu, et pourra donc être réactivé.',
    )
    expect(sent(fetch, SUSPEND)).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Suspendre' }))

    expect(await screen.findByRole('button', { name: 'Réactiver' })).toBeInTheDocument()
    expect(sent(fetch, SUSPEND)).toBe(true)
    expect(screen.getByRole('heading', { level: 1, name: ACME.name })).toHaveFocus()
  })

  it('promises nothing about accounts a customer does not have', async () => {
    const user = userEvent.setup()
    open(WRITER)

    await user.click(await screen.findByRole('button', { name: 'Suspendre' }))
    const dialog = await screen.findByRole('dialog', { name: `Suspendre ${ACME.name} ?` })

    expect(
      await within(dialog).findByText(
        'Ce client n’a aucun compte SMPP : la suspension n’interrompt aucun envoi.',
      ),
    ).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('plus aucun SMS')
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
    await user.click(within(dialog).getByRole('button', { name: 'Suspendre' }))

    expect(sent(fetch, SUSPEND)).toBe(false)
  })

  it('disables and explains every change without customers:write', async () => {
    open(READER)

    for (const name of ['Renommer', 'Suspendre', 'Enregistrer un nom d’expéditeur']) {
      const control = await screen.findByRole('button', { name })
      expect(control).toHaveAttribute('aria-disabled', 'true')
      expect(control).toHaveAccessibleDescription('Modifier un client demande customers:write.')
    }
  })

  it('places an address the customer already registered under its field', async () => {
    const user = userEvent.setup()
    const refusal = 'Ce client a déjà enregistré ce nom.'
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

    await user.click(await screen.findByRole('button', { name: 'Enregistrer un nom d’expéditeur' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Nom' }), 'ACME')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    expect(await within(dialog).findByRole('textbox', { name: 'Nom' })).toHaveAccessibleDescription(
      refusal,
    )
    expect(dialog.querySelector('.form-refusal')).toBeNull()
  })

  it('says the accounts stay suspended before reactivating the customer', async () => {
    const user = userEvent.setup()
    open(WRITER, {}, { customers: [{ ...ACME, status: 'suspended' }] })

    await user.click(await screen.findByRole('button', { name: 'Réactiver' }))
    const dialog = await screen.findByRole('dialog', { name: `Réactiver ${ACME.name} ?` })
    expect(dialog).toHaveTextContent('ses comptes SMPP restent suspendus')
    await user.click(within(dialog).getByRole('button', { name: 'Réactiver' }))

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
    await user.click(within(row).getByRole('button', { name: 'Approuver ACME' }))
    expect(await within(row).findByRole('button', { name: 'Désactiver ACME' })).toBeInTheDocument()
    expect(row).toHaveTextContent('Approuvé')

    await user.click(within(row).getByRole('button', { name: 'Supprimer ACME' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Supprimer le nom d’expéditeur ACME ?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))

    expect(await screen.findByText('Aucun nom d’expéditeur pour l’instant')).toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: 'Enregistrer un nom d’expéditeur' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Nom' }), 'ACME{Enter}')

    const row = (await screen.findByRole('cell', { name: 'ACME' })).closest('tr') as HTMLElement
    expect(row).toHaveTextContent('En attente d’approbation')
    expect(within(row).getByRole('button', { name: 'Approuver ACME' })).toBeInTheDocument()
  })

  it('holds a sender name to 2-11 letters, digits, spaces, + and - before anything leaves', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER)

    await user.click(await screen.findByRole('button', { name: 'Enregistrer un nom d’expéditeur' }))
    const name = within(await screen.findByRole('dialog')).getByRole('textbox', { name: 'Nom' })
    await user.type(name, 'A{Enter}')
    await waitFor(() => expect(name).toHaveAccessibleDescription(/trop courte : 2 caractères/))
    await user.clear(name)
    await user.type(name, 'ABCDEFGHIJKL{Enter}')
    await waitFor(() => expect(name).toHaveAccessibleDescription(/trop longue : 11 caractères/))
    await user.clear(name)
    await user.type(name, 'ACME!{Enter}')
    await waitFor(() => expect(name).toHaveAccessibleDescription(/caractère non accepté/))
    await user.clear(name)
    await user.type(name, 'INFO +225-1')
    expect(name).not.toHaveAccessibleDescription(/non accepté|trop/)

    expect(sent(fetch, `POST /api/customers/${ACME.id}/sender-ids`)).toBe(false)
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

    await user.click(await screen.findByRole('button', { name: 'Désactiver ACME' }))

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
