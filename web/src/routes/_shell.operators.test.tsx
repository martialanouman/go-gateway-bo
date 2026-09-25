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

  it('rend l’état de l’envoi du lien d’accès dans la colonne Statut', async () => {
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

  it('désactive et explique « Envoyer un lien » sur un compte désactivé', async () => {
    await visit(undefined, {}, [SELF, { ...COLLEAGUE, status: 'disabled' }])

    expectBlockedAndExplained(
      row(COLLEAGUE.email).getByRole('button', { name: 'Envoyer un lien' }),
      /désactivé/,
    )
  })

  it('envoie un lien de réinitialisation après une confirmation qui dit que rien ne change avant son usage', async () => {
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

  it('confirme l’envoi d’un lien d’activation en disant sa durée', async () => {
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
