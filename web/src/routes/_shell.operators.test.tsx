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

describe('l’écran des opérateurs', () => {
  it('liste les opérateurs avec leurs rôles et l’état de leur second facteur', async () => {
    await visit()

    expect(row(SELF.email).getByText('super_admin')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun rôle')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun')).toBeInTheDocument()
  })

  it('désactive et explique ce qui enfermerait l’opérateur de la session dehors', async () => {
    await visit()

    expectBlockedAndExplained(
      row(SELF.email).getByRole('button', { name: 'Désactiver' }),
      /propre compte/,
    )
    expectBlockedAndExplained(
      row(SELF.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
      /propre compte/,
    )
  })

  it('désactive et explique une réinitialisation qui n’aurait rien à retirer', async () => {
    await visit()

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
      /aucun second facteur/,
    )
  })

  it('désactive et explique l’attribution de rôles sans roles:manage, qui seule liste les rôles', async () => {
    await visit(['operators:manage'])

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }),
      /roles:manage/,
    )
  })

  it('crée un opérateur, qui apparaît dans la liste', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    await user.type(within(dialog).getByLabelText('Adresse e-mail'), 'n.benali@example.test')
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Nadia Benali')
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'un mot de passe assez long')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))

    expect(await screen.findByRole('cell', { name: /n\.benali@example\.test/ })).toBeInTheDocument()
    expect(await screen.findByText('Nadia Benali peut entrer')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nouvel opérateur' })).not.toBeInTheDocument(),
    )
  })

  it('refuse un mot de passe trop court avant l’aller-retour, en disant la borne du contrat', async () => {
    const user = userEvent.setup()
    const fetch = await visit()

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    await user.type(within(dialog).getByLabelText('Adresse e-mail'), 'n.benali@example.test')
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Nadia Benali')
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'court')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))

    expect(await within(dialog).findByText(/12 caractères au minimum/)).toBeInTheDocument()
    expect(fetch.mock.calls.some(([request]) => request.method === 'POST')).toBe(false)
  })

  it('rend le refus du serveur tel qu’il le rédige', async () => {
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
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'un mot de passe assez long')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))

    expect(
      await within(dialog).findByText('Un compte porte déjà cette adresse.'),
    ).toBeInTheDocument()
  })

  it('attribue un rôle à un collègue', async () => {
    const user = userEvent.setup()
    await visit()

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Modifier les rôles' }))
    const dialog = await screen.findByRole('dialog', { name: `Rôles de ${COLLEAGUE.displayName}` })
    await user.click(await within(dialog).findByRole('checkbox', { name: /auditor/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await row(COLLEAGUE.email).findByText('auditor')).toBeInTheDocument()
  })

  it('confirme la désactivation en nommant sa conséquence, puis l’applique', async () => {
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

  it('rend une panne en état d’erreur, avec le refus du serveur et Réessayer', async () => {
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

  it('réinitialise le second facteur d’un collègue après une confirmation qui dit tout ce qui part', async () => {
    const user = userEvent.setup()
    await visit(undefined, {}, [SELF, { ...COLLEAGUE, secondFactorEnrolled: true }])

    await user.click(
      row(COLLEAGUE.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: `Réinitialiser le second facteur de ${COLLEAGUE.displayName}`,
    })
    expect(dialog).toHaveTextContent(/codes de récupération/)
    expect(dialog).toHaveTextContent(/sessions fermées/)
    await user.click(
      within(dialog).getByRole('button', { name: 'Réinitialiser le second facteur' }),
    )

    expect(await row(COLLEAGUE.email).findByText('Aucun')).toBeInTheDocument()
  })

  it('réactive un collègue désactivé, sans confirmation', async () => {
    const user = userEvent.setup()
    await visit(undefined, {}, [SELF, { ...COLLEAGUE, status: 'disabled' }])

    await user.click(row(COLLEAGUE.email).getByRole('button', { name: 'Réactiver' }))

    expect(
      await row(COLLEAGUE.email).findByRole('button', { name: 'Désactiver' }),
    ).toBeInTheDocument()
  })

  it('retire un rôle à un collègue', async () => {
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

  it('rend en erreur, dans la fenêtre, une liste de rôles illisible, et la relit sur demande', async () => {
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

  it('relit la liste quand l’opérateur demande de réessayer après une panne', async () => {
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
})
