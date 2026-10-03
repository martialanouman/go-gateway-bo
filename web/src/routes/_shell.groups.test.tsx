import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import {
  type AdministrationReplies,
  RESELLERS,
  stubAdministration,
} from '../../test/administration'

const WRITER: PermissionKey[] = ['groups:read', 'groups:write']

function open(
  permissions: PermissionKey[],
  groups = [RESELLERS],
  replies: AdministrationReplies = {},
) {
  stubAdministration({ permissions }, { groups }, replies)
  render(
    <RouterProvider
      router={createAppRouter(createMemoryHistory({ initialEntries: ['/groups'] }))}
    />,
  )
  return screen.findByRole('heading', { level: 1, name: 'Groupes' })
}

async function visit(permissions: PermissionKey[], replies: AdministrationReplies = {}) {
  await open(permissions, [RESELLERS], replies)
  const cell = await screen.findByRole('cell', { name: RESELLERS.name })
  const found = cell.closest('tr')
  if (found === null) throw new Error(`aucune ligne pour ${RESELLERS.name}`)
  return within(found)
}

describe('the groups screen', () => {
  it('places a field refusal from errors[] under the field it names, not in a banner', async () => {
    const user = userEvent.setup()
    const refusal = 'Refus de la passerelle, sous la description.'
    const row = await visit(WRITER, {
      [`PATCH /api/customer-groups/${RESELLERS.id}`]: {
        status: 422,
        body: {
          code: 'description_not_clearable',
          message: refusal,
          errors: [{ field: 'description', message: refusal }],
        },
      },
    })

    await user.click(row.getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog', { name: `Modifier ${RESELLERS.name}` })
    const description = within(dialog).getByLabelText(/Description/)
    await user.clear(description)
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer le groupe' }))

    await expect.poll(() => description.getAttribute('aria-invalid')).toBe('true')
    expect(description).toHaveAccessibleDescription(new RegExp(refusal))
    expect(within(dialog).getAllByText(refusal)).toHaveLength(1)
    expect(dialog.querySelector('.form-refusal')).toBeNull()
  })

  it('disables and explains every change for an operator who only reads groups', async () => {
    const row = await visit(['groups:read'])

    for (const button of [
      screen.getByRole('button', { name: 'Nouveau groupe' }),
      row.getByRole('button', { name: 'Modifier' }),
      row.getByRole('button', { name: 'Archiver' }),
      row.getByRole('button', { name: 'Supprimer' }),
    ]) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription(/groups:write/)
    }
  })

  it('creates a group from the archived tab, then shows it under Actifs with focus on the title', async () => {
    const user = userEvent.setup()
    await visit(WRITER)

    await user.click(screen.getByRole('tab', { name: 'Archivés' }))
    await screen.findByRole('heading', { level: 2, name: 'Aucun groupe archivé' })
    await user.click(screen.getByRole('button', { name: 'Nouveau groupe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau groupe' })
    await user.type(within(dialog).getByLabelText('Nom'), 'Grands comptes')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le groupe' }))

    expect(await screen.findByText('Grands comptes est créé.')).toBeInTheDocument()
    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByRole('cell', { name: 'Grands comptes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Actifs' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Groupes' })).toHaveFocus(),
    )
  })

  it('sends nothing when an edit changes nothing', async () => {
    const user = userEvent.setup()
    const row = await visit(WRITER)
    const patches = () =>
      vi.mocked(fetch).mock.calls.filter(([request]) => (request as Request).method === 'PATCH')
        .length

    await user.click(row.getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog', { name: `Modifier ${RESELLERS.name}` })
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer le groupe' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches()).toBe(0)
  })

  it('refuses an empty name under its field, before any request', async () => {
    const user = userEvent.setup()
    await visit(WRITER)

    await user.click(screen.getByRole('button', { name: 'Nouveau groupe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau groupe' })
    await user.click(within(dialog).getByRole('button', { name: 'Créer le groupe' }))

    expect(within(dialog).getByLabelText('Nom')).toHaveAccessibleDescription(/trop courte/)
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says why an archive was refused, and keeps the group where it was', async () => {
    const user = userEvent.setup()
    const row = await visit(WRITER, {
      [`PATCH /api/customer-groups/${RESELLERS.id}`]: {
        status: 503,
        body: { code: 'bff_upstream_unreachable', message: 'La passerelle n’a pas pu répondre.' },
      },
    })

    await user.click(row.getByRole('button', { name: 'Archiver' }))

    expect(await screen.findByText('La passerelle n’a pas pu répondre.')).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Archiver' })).toBeInTheDocument()
  })

  it('archives a group, which moves under Archivés, and gives focus back to the title', async () => {
    const user = userEvent.setup()
    const row = await visit(WRITER)

    await user.click(row.getByRole('button', { name: 'Archiver' }))

    expect(await screen.findByText(/Revendeurs est archivé/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Groupes' })).toHaveFocus(),
    )
    await user.click(screen.getByRole('tab', { name: 'Archivés' }))
    const archived = await screen.findByRole('cell', { name: RESELLERS.name })
    const archivedRow = within(archived.closest('tr') as HTMLElement)
    expect(archivedRow.getByText('Archivé')).toBeInTheDocument()

    await user.click(archivedRow.getByRole('button', { name: 'Désarchiver' }))
    expect(await screen.findByText(/Revendeurs est de nouveau actif/)).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Aucun groupe archivé' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(await screen.findByRole('cell', { name: RESELLERS.name })).toBeInTheDocument()
  })

  it('deletes a group after a confirmation that counts the customers it detaches', async () => {
    const user = userEvent.setup()
    const row = await visit(WRITER)

    expect(row.getByRole('cell', { name: '1' })).toBeInTheDocument()
    await user.click(row.getByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('dialog', { name: `Supprimer ${RESELLERS.name}` })
    expect(dialog).toHaveTextContent(
      'Son client est détaché du groupe ; aucun client n’est supprimé.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le groupe' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Aucun groupe pour l’instant' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Groupes' })).toHaveFocus()
  })

  it('says how to create the first group when there is none', async () => {
    const user = userEvent.setup()
    await open(WRITER, [])

    await screen.findByRole('heading', { level: 2, name: 'Aucun groupe pour l’instant' })
    const creates = screen.getAllByRole('button', { name: 'Nouveau groupe' })
    expect(creates).toHaveLength(2)
    await user.click(creates[1] as HTMLElement)
    expect(await screen.findByRole('dialog', { name: 'Nouveau groupe' })).toBeInTheDocument()
  })

  it('shows an unavailable gateway as an error to retry, not as an empty list', async () => {
    const user = userEvent.setup()
    await open(WRITER, [RESELLERS], {
      'GET /api/customer-groups': {
        status: 503,
        body: { code: 'bff_upstream_unreachable', message: 'La passerelle n’a pas pu répondre.' },
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Les groupes n’ont pas pu être chargés')
    const reads = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([request]) => (request as Request).url.includes('/api/customer-groups'))
        .length
    const before = reads()
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
  })
})
