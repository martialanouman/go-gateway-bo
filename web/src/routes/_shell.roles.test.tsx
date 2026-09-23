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

describe('l’écran des rôles', () => {
  it('désactive et explique la modification et la suppression d’un rôle par défaut', async () => {
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

  it('désactive la suppression d’un rôle détenu, en nommant ses détenteurs', async () => {
    await visit()

    expectBlockedAndExplained(
      row(ON_CALL.name).getByRole('button', { name: 'Supprimer' }),
      new RegExp(COLLEAGUE.email.replace('.', '\\.')),
    )
  })

  it('montre les clés qu’un rôle par défaut accorde, à côté de sa description', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(SUPER_ADMIN.name).getByRole('button', { name: 'Voir les permissions' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôle ${SUPER_ADMIN.name}` })
    expect(dialog).toHaveTextContent(SUPER_ADMIN.description)
    expect(within(dialog).getByText('operators:manage')).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('compose un rôle personnalisé, qui apparaît dans la liste', async () => {
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

  it('modifie un rôle personnalisé, dont la nouvelle clé se relit', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(ON_CALL.name).getByRole('button', { name: 'Modifier' }))
    const dialog = await screen.findByRole('dialog', { name: `Modifier ${ON_CALL.name}` })
    expect(within(dialog).getByRole('checkbox', { name: /alerts:read/ })).toBeChecked()
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
  })

  it('supprime un rôle personnalisé que personne ne détient, après confirmation', async () => {
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
})
