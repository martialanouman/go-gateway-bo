import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createAppRouter } from '~/router'
import {
  AUDITOR,
  COLLEAGUE,
  ON_CALL,
  SUPER_ADMIN,
  stubAdministration,
} from '../../test/administration'

async function visit() {
  const fetch = stubAdministration({ permissions: ['roles:manage'] })
  render(
    <RouterProvider
      router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
    />,
  )
  await screen.findByRole('heading', { level: 1, name: 'Rôles' })
  await screen.findByRole('cell', { name: ON_CALL.name })

  return fetch
}

function row(name: string) {
  const found = screen.getByRole('cell', { name }).closest('tr')
  if (found === null) throw new Error(`aucune ligne pour ${name}`)
  return within(found)
}

function expectBlockedAndExplained(button: HTMLElement, reason: RegExp) {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(reason)
}

describe('the roles screen', () => {
  it('disables and explains editing and deleting a default role', async () => {
    await visit()

    expectBlockedAndExplained(
      row(AUDITOR.name).getByRole('button', { name: 'Modifier' }),
      /déploiement/,
    )
    expectBlockedAndExplained(
      row(AUDITOR.name).getByRole('button', { name: 'Supprimer' }),
      /déploiement/,
    )
  })

  it('disables deleting a held role, naming its holders', async () => {
    await visit()

    expectBlockedAndExplained(
      row(ON_CALL.name).getByRole('button', { name: 'Supprimer' }),
      new RegExp(COLLEAGUE.email.replace('.', '\\.')),
    )
  })

  it('shows the keys a default role grants, next to its description', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(SUPER_ADMIN.name).getByRole('button', { name: 'Voir les permissions' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rôle Propriétaire' })
    expect(dialog).toHaveTextContent(SUPER_ADMIN.description)
    expect(within(dialog).getByText('operators:manage')).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('composes a custom role, which appears in the list', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(screen.getByRole('button', { name: 'Nouveau rôle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau rôle' })
    await user.type(within(dialog).getByLabelText('Nom'), 'astreinte_nuit')
    await user.click(within(dialog).getByRole('checkbox', { name: /alerts:read/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Créer le rôle' }))

    expect(await screen.findByRole('cell', { name: 'astreinte_nuit' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nouveau rôle' })).not.toBeInTheDocument(),
    )
  })

  it('edits a custom role, whose new key reads back', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(ON_CALL.name).getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog', { name: `Modifier ${ON_CALL.name}` })
    expect(within(dialog).getByRole('checkbox', { name: /alerts:read/ })).toBeChecked()
    await user.clear(within(dialog).getByLabelText(/Description/))
    await user.type(
      within(dialog).getByLabelText(/Description/),
      'Alertes, lecture et acquittement.',
    )
    await user.click(within(dialog).getByRole('checkbox', { name: /alerts:write/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer le rôle' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: `Modifier ${ON_CALL.name}` }),
      ).not.toBeInTheDocument(),
    )
    await user.click(row(ON_CALL.name).getByRole('button', { name: 'Voir les permissions' }))
    const view = await screen.findByRole('dialog', { name: `Rôle ${ON_CALL.name}` })
    expect(within(view).getByText('alerts:write')).toBeInTheDocument()
    expect(within(view).getByText('alerts:read')).toBeInTheDocument()
    expect(view).toHaveTextContent('Alertes, lecture et acquittement.')
  })

  it('deletes a custom role nobody holds, after confirmation', async () => {
    const user = userEvent.setup()
    stubAdministration(
      { permissions: ['roles:manage'] },
      { roles: [SUPER_ADMIN, { ...ON_CALL, holders: [] }] },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    await user.click(
      within(
        (await screen.findByRole('cell', { name: ON_CALL.name })).closest('tr') as HTMLElement,
      ).getByRole('button', { name: 'Supprimer' }),
    )
    const dialog = await screen.findByRole('dialog', { name: `Supprimer ${ON_CALL.name}` })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le rôle' }))

    await waitFor(() =>
      expect(screen.queryByRole('cell', { name: ON_CALL.name })).not.toBeInTheDocument(),
    )
  })

  it('renders an outage as an error state, and reloads the list on request', async () => {
    const user = userEvent.setup()
    const fetch = stubAdministration(
      { permissions: ['roles:manage'] },
      {},
      { 'GET /api/roles': { status: 500, body: { code: 'internal_error', message: 'Panne.' } } },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Panne.')
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))

    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/roles'),
      ).toHaveLength(2),
    )
  })

  it('moves focus to the heading after a deletion, rather than losing it with the row', async () => {
    const user = userEvent.setup()
    stubAdministration(
      { permissions: ['roles:manage'] },
      { roles: [SUPER_ADMIN, { ...ON_CALL, holders: [] }] },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    await user.click(
      within(
        (await screen.findByRole('cell', { name: ON_CALL.name })).closest('tr') as HTMLElement,
      ).getByRole('button', { name: 'Supprimer' }),
    )
    await user.click(
      within(await screen.findByRole('dialog', { name: `Supprimer ${ON_CALL.name}` })).getByRole(
        'button',
        {
          name: 'Supprimer le rôle',
        },
      ),
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Rôles' })).toHaveFocus(),
    )
  })

  it('disables and explains creation without roles:manage', async () => {
    stubAdministration(
      { permissions: [] },
      {},
      {
        'GET /api/roles': { status: 403, body: { code: 'permission_denied', message: 'Refusé.' } },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    expectBlockedAndExplained(
      await screen.findByRole('button', { name: 'Nouveau rôle' }),
      /roles:manage/,
    )
  })

  it('renders in the editor the refusal of a name already taken', async () => {
    const user = userEvent.setup()
    stubAdministration(
      { permissions: ['roles:manage'] },
      {},
      {
        'POST /api/roles': {
          status: 409,
          body: { code: 'role_name_taken', message: 'Nom déjà porté.' },
        },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Nouveau rôle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouveau rôle' })
    await user.type(within(dialog).getByLabelText('Nom'), 'ops')
    await user.click(within(dialog).getByRole('button', { name: 'Créer le rôle' }))

    expect(await within(dialog).findByText('Nom déjà porté.')).toBeInTheDocument()
  })

  it('renders in the confirmation the refusal of a deletion that became impossible', async () => {
    const user = userEvent.setup()
    stubAdministration(
      { permissions: ['roles:manage'] },
      { roles: [SUPER_ADMIN, { ...ON_CALL, holders: [] }] },
      {
        [`DELETE /api/roles/${ON_CALL.id}`]: {
          status: 409,
          body: { code: 'role_held', message: 'Détenu entre-temps.' },
        },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/roles'] }))}
      />,
    )

    await user.click(
      within(
        (await screen.findByRole('cell', { name: ON_CALL.name })).closest('tr') as HTMLElement,
      ).getByRole('button', { name: 'Supprimer' }),
    )
    const dialog = await screen.findByRole('dialog', { name: `Supprimer ${ON_CALL.name}` })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer le rôle' }))

    expect(await within(dialog).findByText('Détenu entre-temps.')).toBeInTheDocument()
  })
})
