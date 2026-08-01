/**
 * L'écran des opérateurs, avec ses modales.
 *
 * ## Pourquoi ici et non dans le test de route
 *
 * Ouvrir une surface flottante de Base UI sous `renderRoute` fait boucler le processus : l'arbre de
 * routes monte un `<html>` dans la `<div>` de Testing Library, et la boucle est synchrone, donc
 * `testTimeout` ne la coupe pas. Monté hors du routeur, le même écran s'ouvre et se saisit — c'est
 * la raison pour laquelle la route ne fait plus que déclarer, et l'écran vit dans un composant.
 *
 * ## Ce que le harnais fournit, et ce que cela cache
 *
 * `ToastProvider`, que la coquille pose en production (`AppShell`). Un provider fourni par le test
 * a déjà masqué son absence en production une fois dans ce dépôt ; ici, `_shell.operateurs.test.tsx`
 * monte l'écran **sous la vraie coquille**, et le parcours Playwright l'exerce dans un vrai
 * navigateur. Les trois se complètent au lieu de se remplacer.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, ToastStack } from '~/components/overlays'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient, renderComponent } from '~/test/render'
import { stubFetch } from '~/test/stub-fetch'
import { OperateursScreen } from './operators-screen'

afterEach(() => {
  vi.unstubAllGlobals()
})

const ADMIN = {
  id: 'op-1',
  email: 'admin@example.test',
  displayName: 'Administratrice',
  permissions: ['operators:manage'],
  mfaCompleted: true,
}

const DIRECTORY = {
  operators: [
    {
      id: 'op-1',
      email: 'admin@example.test',
      displayName: 'Administratrice',
      status: 'active' as const,
      lastLoginAt: '2026-07-30T08:15:00.000Z',
      mfaEnrolled: true,
      roles: [{ id: 'role-1', name: 'super_admin' }],
    },
  ],
  roles: [
    { id: 'role-1', name: 'super_admin', isDefault: true },
    { id: 'role-2', name: 'auditor', isDefault: true },
    { id: 'role-3', name: 'support_n2', isDefault: false },
  ],
}

const SECRET = 'ABCDEFGHJKMN23456789'

function renderScreen() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(OPERATOR_QUERY_KEY, ADMIN)

  return renderComponent(
    <ToastProvider>
      <OperateursScreen />
      <ToastStack />
    </ToastProvider>,
    { queryClient },
  )
}

describe('la création d’un opérateur', () => {
  it('montre le mot de passe initial, puis ne le remontre plus', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/create': { body: { operatorId: 'op-2', temporaryPassword: SECRET } },
      '/api/admin/operators': { body: DIRECTORY },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Créer un opérateur' }))
    await screen.user.type(screen.getByLabelText(/Adresse email/), 'recrue@example.test')
    await screen.user.type(screen.getByLabelText(/Nom affiché/), 'Recrue')
    await screen.user.click(screen.getByRole('checkbox', { name: 'auditor' }))
    await screen.user.click(screen.getByRole('button', { name: 'Créer le compte' }))

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    // La modale annonce l'unicité **avant** de montrer la valeur : celui qui ferme trop vite doit
    // refaire une création.
    expect(screen.getByText(/qu’une seule fois/)).toBeInTheDocument()

    await screen.user.click(screen.getByRole('button', { name: 'J’ai noté le mot de passe' }))
    await screen.user.click(screen.getByRole('button', { name: 'Créer un opérateur' }))

    // **Invariant (b)** : rouvrir la modale ne réaffiche pas un secret déjà montré.
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('garde le refus dans la modale, sans perdre la saisie', async () => {
    const refus =
      'Création refusée : un opérateur utilise déjà l’adresse « admin@example.test » — la casse ne les distingue pas.'

    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/create': { body: { error: refus }, status: 409 },
      '/api/admin/operators': { body: DIRECTORY },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Créer un opérateur' }))
    await screen.user.type(screen.getByLabelText(/Adresse email/), 'admin@example.test')
    await screen.user.type(screen.getByLabelText(/Nom affiché/), 'Doublon')
    await screen.user.click(screen.getByRole('button', { name: 'Créer le compte' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(refus)
    // La saisie survit au refus : corriger l'adresse ne doit pas obliger à tout retaper.
    expect(screen.getByLabelText(/Nom affiché/)).toHaveValue('Doublon')
  })
})

describe('les actions sur une ligne', () => {
  it('affiche un refus de règle en bandeau, jamais en toast', async () => {
    // Ce message cite entre guillemets, forme sur laquelle `assertToastText` **lève**. Un écran qui
    // l'enverrait en toast planterait dans son gestionnaire de clic au lieu d'afficher le refus.
    const refus =
      'Changement refusé : votre compte perdrait la permission « operators:manage », et plus personne ne pourrait vous la rendre depuis cet écran.'

    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/update': { body: { error: refus }, status: 409 },
      '/api/admin/operators': { body: DIRECTORY },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Actions' }))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Désactiver le compte' }))
    await screen.user.click(screen.getByRole('button', { name: 'Désactiver le compte' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(refus)
  })

  it('enregistre un changement de rôles et l’annonce', async () => {
    const calls = stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/update': { body: { closedSessions: 0 } },
      '/api/admin/operators': { body: DIRECTORY },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Actions' }))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Modifier les rôles' }))
    await screen.user.click(screen.getByRole('checkbox', { name: 'auditor' }))
    await screen.user.click(screen.getByRole('button', { name: 'Enregistrer les rôles' }))

    expect(await screen.findByText('Rôles enregistrés.')).toBeInTheDocument()
    expect(calls).toContain('/api/admin/operators/update')
  })

  it('efface un second facteur et dit combien de sessions se sont fermées', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/mfa-reset': { body: { closedSessions: 2 } },
      '/api/admin/operators': { body: DIRECTORY },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Actions' }))
    await screen.user.click(
      await screen.findByRole('menuitem', { name: 'Réinitialiser le second facteur' }),
    )
    await screen.user.click(screen.getByRole('button', { name: 'Effacer le second facteur' }))

    // Le nombre de sessions fermées est ce qui dit qu'un appareil volé n'est plus connecté : le
    // taire laisserait croire que seul le facteur a changé.
    expect(await screen.findByText(/Sessions fermées : 2/)).toBeInTheDocument()
  })
})

describe('la réactivation', () => {
  it('ne promet pas de fermer des sessions, et le dit', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators/update': { body: { closedSessions: 0 } },
      '/api/admin/operators': {
        body: {
          ...DIRECTORY,
          operators: [{ ...DIRECTORY.operators[0], status: 'disabled' as const }],
        },
      },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Actions' }))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Réactiver le compte' }))

    // La conséquence d'une réactivation n'est pas la symétrique d'une désactivation : le second
    // facteur et les rôles sont intacts, et rien ne se ferme.
    expect(screen.getByText(/Ses rôles sont inchangés/)).toBeInTheDocument()

    await screen.user.click(screen.getByRole('button', { name: 'Réactiver le compte' }))
    expect(await screen.findByText('Compte réactivé.')).toBeInTheDocument()
  })
})

describe('les états de contenu', () => {
  it('peint l’erreur avec sa réalité HTTP, et propose de réessayer', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators': { body: { error: 'panne' }, status: 503 },
    })

    const screen = renderScreen()

    expect(await screen.findByRole('alert')).toHaveTextContent('503')
    expect(screen.getByText(/Vos données locales restent affichées/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('distingue « rien encore » d’une panne', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/operators': { body: { operators: [], roles: [] } },
    })

    const screen = renderScreen()

    expect(await screen.findByText('Aucun opérateur')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // L'état vide **propose de créer** : c'est ce qui le distingue de « aucun résultat ». Et la
    // modale, sans aucun rôle à proposer, dit ce que cela coûte plutôt que d'afficher un vide.
    // Deux déclencheurs portent ce nom — celui de l'en-tête et celui de l'état vide. L'état vide
    // **propose de créer**, et c'est ce qui le distingue de « aucun résultat » : on prend le sien.
    const declencheurs = screen.getAllByRole('button', { name: 'Créer un opérateur' })
    await screen.user.click(declencheurs[declencheurs.length - 1] as HTMLElement)

    // Sans aucun rôle à proposer, la modale dit ce que cela coûte plutôt que d'afficher un vide.
    expect(screen.getByText(/Aucun rôle n’existe encore/)).toBeInTheDocument()
  })
})
