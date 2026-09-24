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

    expect(row(SELF.email).getByText('Propriétaire')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun rôle')).toBeInTheDocument()
    expect(row(COLLEAGUE.email).getByText('Aucun')).toBeInTheDocument()
  })

  it('désactive et explique ce qui enfermerait l’opérateur de la session dehors', async () => {
    await visit()

    expectBlockedAndExplained(
      row(SELF.email).getByRole('button', { name: 'Désactiver' }),
      /compte de la session/,
    )
    expectBlockedAndExplained(
      row(SELF.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
      /compte de la session/,
    )
  })

  it('désactive et explique une réinitialisation qui n’aurait rien à retirer', async () => {
    await visit()

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
      /Aucun second facteur/,
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
    expect(await screen.findByText(/Compte de Nadia Benali créé/)).toBeInTheDocument()
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
    await user.click(await within(dialog).findByRole('checkbox', { name: /Audit/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await row(COLLEAGUE.email).findByText('Audit')).toBeInTheDocument()
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

  it('ne garde le mot de passe saisi ni dans le formulaire rouvert ni dans le cache (invariant b)', async () => {
    const user = userEvent.setup()
    stubAdministration(
      { permissions: ['operators:manage', 'roles:manage'] },
      {},
      {
        'POST /api/operators': {
          status: 409,
          body: { code: 'email_taken', message: 'Déjà pris.' },
        },
      },
    )
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/operators'] }))
    render(<RouterProvider router={router} />)
    await screen.findByRole('cell', { name: new RegExp(COLLEAGUE.email) })

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    let dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    await user.type(within(dialog).getByLabelText('Adresse e-mail'), COLLEAGUE.email)
    await user.type(within(dialog).getByLabelText('Nom affiché'), 'Martin Leroy')
    await user.type(within(dialog).getByLabelText('Mot de passe'), 'un secret assez long')
    await user.click(within(dialog).getByRole('button', { name: 'Créer l’opérateur' }))
    await within(dialog).findByText('Déjà pris.')
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nouvel opérateur' })).not.toBeInTheDocument(),
    )

    const cached = JSON.stringify(
      router.options.context.queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    )
    expect(cached).not.toContain('un secret assez long')

    await user.click(screen.getByRole('button', { name: 'Nouvel opérateur' }))
    dialog = await screen.findByRole('dialog', { name: 'Nouvel opérateur' })
    expect(within(dialog).getByLabelText('Mot de passe')).toHaveValue('')
  })

  it('rend l’échec d’une réactivation, sur la ligne qui l’a demandée', async () => {
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

  it('désactive et explique la création sans operators:manage', async () => {
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

  it('rend dans la fenêtre des rôles le refus d’auto-verrouillage que le serveur rédige', async () => {
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

  it('rend dans la confirmation le refus d’une désactivation', async () => {
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

  it('rend dans la confirmation le refus d’une réinitialisation', async () => {
    const user = userEvent.setup()
    await visit(
      undefined,
      {
        [`DELETE /api/operators/${COLLEAGUE.id}/second-factors`]: {
          status: 404,
          body: { code: 'not_found', message: 'Opérateur introuvable.' },
        },
      },
      [SELF, { ...COLLEAGUE, secondFactorEnrolled: true }],
    )

    await user.click(
      row(COLLEAGUE.email).getByRole('button', { name: 'Réinitialiser le second facteur' }),
    )
    const dialog = await screen.findByRole('dialog', {
      name: `Réinitialiser le second facteur de ${COLLEAGUE.displayName}`,
    })
    await user.click(
      within(dialog).getByRole('button', { name: 'Réinitialiser le second facteur' }),
    )

    expect(await within(dialog).findByText('Opérateur introuvable.')).toBeInTheDocument()
  })

  it('n’enregistre pas des rôles que la fenêtre n’a pas su lire', async () => {
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

  it('écrit les rôles en français, en texte courant', async () => {
    await visit()

    for (const text of ['Aucun rôle', 'Propriétaire']) {
      const holder = text === 'Aucun rôle' ? COLLEAGUE.email : SELF.email
      expect(row(holder).getByText(text).closest('.mono, .ui-table__cell--mono')).toBeNull()
    }
  })

  it('montre « Configuré » pour un opérateur qui a un second facteur', async () => {
    await visit()

    expect(row(SELF.email).getByText('Configuré')).toBeInTheDocument()
  })
})
