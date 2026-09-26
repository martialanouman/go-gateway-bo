import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import {
  type AdministrationReplies,
  COLLEAGUE,
  ON_CALL,
  SELF,
  stubAdministration,
} from '../../test/administration'

async function visit(
  permissions: readonly PermissionKey[] = ['operators:manage', 'roles:manage'],
  replies: AdministrationReplies = {},
  operators = [SELF, COLLEAGUE],
) {
  const fetch = stubAdministration({ permissions }, { operators }, replies)
  render(
    <RouterProvider
      router={createAppRouter(createMemoryHistory({ initialEntries: ['/operators'] }))}
    />,
  )
  await screen.findByRole('heading', { level: 1, name: 'Opérateurs' })
  await screen.findByRole('cell', { name: new RegExp(COLLEAGUE.email) })

  return fetch
}

function row(email: string) {
  const cell = screen.getByRole('cell', { name: new RegExp(email) })
  const found = cell.closest('tr')
  if (found === null) throw new Error(`aucune ligne pour ${email}`)
  return within(found)
}

/** Un contrôle interdit reste visible, dans le parcours clavier, et dit pourquoi. */
function expectBlockedAndExplained(button: HTMLElement, reason: RegExp) {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(reason)
}

describe('the operators screen', () => {
  it('lists operators with their roles and the state of their second factor', async () => {
    await visit()

    expect(row(SELF.email).getByText('Propriétaire')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun rôle')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun')).toBeInTheDocument()
  })

  it('disables and explains what would lock the session operator out', async () => {
    await visit()

    expectBlockedAndExplained(
      row(SELF.email).getByRole('button', { name: 'Désactiver' }),
      /compte de la session/,
    )
  })

  it('disables and explains role assignment without roles:manage, which alone lists the roles', async () => {
    await visit(['operators:manage'])

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }),
      /roles:manage/,
    )
  })

  it('creates an operator, who appears in the list', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    await user.type(within(dialog).getByLabelText('Adresse e-mail'), 'n.benali@example.test')
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Nadia Benali')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))

    expect(await screen.findByRole('cell', { name: /n\.benali@example\.test/ })).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Compte créé. Le lien d’activation part à n.benali@example.test ; il vaut 72 heures.',
      ),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nouvel opérateur' })).not.toBeInTheDocument(),
    )
  })

  it('renders the server refusal as the server writes it', async () => {
    const user = userEvent.setup()
    await visit(undefined, {
      'POST /api/operators': {
        status: 409,
        body: { code: 'email_taken', message: 'Un compte porte déjà cette adresse.' },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    await user.type(within(dialog).getByLabelText('Adresse e-mail'), COLLEAGUE.email)
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Martin Leroy')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))

    expect(
      await within(dialog).findByText('Un compte porte déjà cette adresse.'),
    ).toBeInTheDocument()
  })

  it('assigns a role to a colleague', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    await user.click(await within(dialog).findByRole('checkbox', { name: /Audit/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await row(COLLEAGUE.email).findByText('Audit')).toBeInTheDocument()
  })

  it('confirms the deactivation by naming its consequence, then applies it', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Désactiver' }))
    const dialog = await screen.findByRole('dialog', {
      name: `Désactiver ${COLLEAGUE.displayName}`,
    })
    expect(dialog).toHaveTextContent(/sessions sont fermées/)
    await user.click(within(dialog).getByRole('button', { name: 'Désactiver le compte' }))

    expect(
      await row(COLLEAGUE.email).findByRole('button', { name: 'Réactiver' }),
    ).toBeInTheDocument()
  })

  it('renders an outage as an error state, with the server refusal and Réessayer', async () => {
    stubAdministration(
      { permissions: ['operators:manage'] },
      {},
      {
        'GET /api/operators': {
          status: 403,
          body: {
            code: 'permission_denied',
            message: 'Votre compte ne détient pas la permission.',
          },
        },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/operators'] }))}
      />,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Votre compte ne détient pas la permission.')
    expect(within(alert).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('reactivates a deactivated colleague, without confirmation', async () => {
    const user = userEvent.setup()
    await visit(undefined, {}, [SELF, { ...COLLEAGUE, status: 'disabled' }])

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Réactiver' }))

    expect(
      await row(COLLEAGUE.email).findByRole('button', { name: 'Désactiver' }),
    ).toBeInTheDocument()
  })

  it('removes a role from a colleague', async () => {
    const user = userEvent.setup()
    await visit(undefined, {}, [
      SELF,
      { ...COLLEAGUE, roles: [{ id: ON_CALL.id, name: ON_CALL.name }] },
    ])

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    await user.click(await within(dialog).findByRole('checkbox', { name: /astreinte/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await row(COLLEAGUE.email).findByText('Aucun rôle')).toBeInTheDocument()
  })

  it('renders an unreadable role list as an error, in the dialog, and rereads it on request', async () => {
    const user = userEvent.setup()
    const fetch = await visit(undefined, {
      'GET /api/roles': {
        status: 500,
        body: { code: 'internal_error', message: 'Panne de test.' },
      },
    })

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Panne de test.')

    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }))
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/roles'),
      ).toHaveLength(2),
    )
  })

  it('rereads the list when the operator asks to retry after an outage', async () => {
    const user = userEvent.setup()
    const fetch = stubAdministration(
      { permissions: ['operators:manage'] },
      {},
      {
        'GET /api/operators': { status: 500, body: { code: 'internal_error', message: 'Panne.' } },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/operators'] }))}
      />,
    )

    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Réessayer' }),
    )

    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/api/operators'),
      ).toHaveLength(2),
    )
  })

  it('renders a failed reactivation on the row that requested it', async () => {
    const user = userEvent.setup()
    await visit(
      undefined,
      {
        [`PATCH /api/operators/${COLLEAGUE.id}`]: {
          status: 404,
          body: { code: 'not_found', message: 'Aucun opérateur ne porte cet identifiant.' },
        },
      },
      [SELF, { ...COLLEAGUE, status: 'disabled' }],
    )

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Réactiver' }))

    expect(await screen.findByText('Aucun opérateur ne porte cet identifiant.')).toBeInTheDocument()
  })

  it('disables and explains creation without operators:manage', async () => {
    stubAdministration(
      { permissions: [] },
      {},
      {
        'GET /api/operators': {
          status: 403,
          body: { code: 'permission_denied', message: 'Refusé.' },
        },
      },
    )
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/operators'] }))}
      />,
    )

    expectBlockedAndExplained(
      await screen.findByRole('button', { name: 'Nouvel opérateur' }),
      /operators:manage/,
    )
  })

  it('renders in the roles dialog the self-lockout refusal that the server writes', async () => {
    const user = userEvent.setup()
    await visit(undefined, {
      [`POST /api/operators/${COLLEAGUE.id}/roles`]: {
        status: 409,
        body: { code: 'self_lockout', message: 'Rien n’a été changé.' },
      },
    })

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    await within(dialog).findByRole('checkbox', { name: /Audit/ })
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await within(dialog).findByText('Rien n’a été changé.')).toBeInTheDocument()
  })

  it('renders the refusal of a deactivation in the confirmation', async () => {
    const user = userEvent.setup()
    await visit(undefined, {
      [`PATCH /api/operators/${COLLEAGUE.id}`]: {
        status: 409,
        body: { code: 'self_lockout', message: 'Le compte reste actif.' },
      },
    })

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Désactiver' }))
    const dialog = await screen.findByRole('dialog', {
      name: `Désactiver ${COLLEAGUE.displayName}`,
    })
    await user.click(within(dialog).getByRole('button', { name: 'Désactiver le compte' }))

    expect(await within(dialog).findByText('Le compte reste actif.')).toBeInTheDocument()
  })

  it('does not save roles that the dialog could not read', async () => {
    const user = userEvent.setup()
    const fetch = await visit(undefined, {
      'GET /api/roles': { status: 500, body: { code: 'internal_error', message: 'Panne.' } },
    })

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    await within(dialog).findByRole('alert')
    const save = within(dialog).getByRole('button', { name: 'Enregistrer les rôles' })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    await user.click(save)

    expect(
      fetch.mock.calls.some(
        ([request]) => request.url.endsWith('/roles') && request.method === 'POST',
      ),
    ).toBe(false)
  })

  it('writes the roles in French, as running text', async () => {
    await visit()

    for (const text of ['Aucun rôle', 'Propriétaire']) {
      const holder = text === 'Aucun rôle' ? COLLEAGUE.email : SELF.email
      expect(row(holder).getByText(text).closest('.mono, .ui-table__cell--mono')).toBeNull()
    }
  })

  it('shows « Configuré » for an operator who has a second factor', async () => {
    await visit()

    expect(row(SELF.email).getByText('Configuré')).toBeInTheDocument()
  })

  it('renders the state of the access link delivery in the Statut column', async () => {
    const activating = {
      ...COLLEAGUE,
      accessLink: { kind: 'activation', state: 'queued' } as const,
    }
    const sent = {
      ...COLLEAGUE,
      id: 'op-sent',
      email: 'lien.envoye@example.test',
      accessLink: { kind: 'reset', state: 'sent' } as const,
    }
    const failed = {
      ...COLLEAGUE,
      id: 'op-failed',
      email: 'envoi.echec@example.test',
      accessLink: { kind: 'activation', state: 'failed' } as const,
    }
    const resetting = {
      ...COLLEAGUE,
      id: 'op-resetting',
      email: 'envoi.attente@example.test',
      accessLink: { kind: 'reset', state: 'queued' } as const,
    }
    await visit(undefined, {}, [SELF, activating, sent, failed, resetting])

    expect(row(activating.email).getByText('Activation en attente')).toBeInTheDocument()
    expect(row(sent.email).getByText('Lien envoyé')).toBeInTheDocument()
    expect(row(failed.email).getByText('Envoi en échec')).toBeInTheDocument()
    expect(row(resetting.email).getByText('Envoi en attente')).toBeInTheDocument()
  })

  it('disables and explains « Envoyer un lien » on a deactivated account', async () => {
    await visit(undefined, {}, [SELF, { ...COLLEAGUE, status: 'disabled' }])

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Envoyer un lien' }),
      /désactivé/,
    )
  })

  it('keeps « Envoyer un lien » active on the session row, where it opens the confirmation', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(SELF.email).getByRole('button', { name: 'Envoyer un lien' }))

    expect(
      await screen.findByRole('dialog', { name: `Envoyer un lien à ${SELF.displayName}` }),
    ).toBeInTheDocument()
  })

  it('sends a reset link after a confirmation saying nothing changes before it is used', async () => {
    const user = userEvent.setup()
    const fetch = await visit()

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Envoyer un lien' }))
    const dialog = await screen.findByRole('dialog', {
      name: `Envoyer un lien à ${COLLEAGUE.displayName}`,
    })
    expect(dialog).toHaveTextContent(/Rien ne change avant son usage/)
    expect(dialog).toHaveTextContent(/second facteur est retiré/)
    await user.click(within(dialog).getByRole('button', { name: 'Envoyer le lien' }))

    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([request]) =>
            request.method === 'POST' &&
            new URL(request.url).pathname === `/api/operators/${COLLEAGUE.id}/access-link`,
        ),
      ).toBe(true),
    )
    expect(await row(COLLEAGUE.email).findByText('Lien envoyé')).toBeInTheDocument()
  })

  it('confirms sending an activation link by stating its duration', async () => {
    const user = userEvent.setup()
    const pending = { ...COLLEAGUE, accessLink: { kind: 'activation', state: 'queued' } as const }
    await visit(undefined, {}, [SELF, pending])

    await user.click(row(pending.email).getByRole('button', { name: 'Envoyer un lien' }))
    const dialog = await screen.findByRole('dialog', {
      name: `Envoyer un lien à ${pending.displayName}`,
    })
    expect(dialog).toHaveTextContent(/72 heures/)
    expect(dialog).toHaveTextContent(/lien envoyé plus tôt cesse de valoir/)
  })
})
