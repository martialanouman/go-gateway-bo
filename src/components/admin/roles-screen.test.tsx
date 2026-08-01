/**
 * L'écran des rôles, avec son éditeur de permissions et son aperçu d'impact.
 *
 * Même raison qu'`operators-screen.test.tsx` de vivre hors du test de route : les modales de Base UI
 * font boucler `renderRoute`. Ce qui est vérifié ici est ce qui décide d'un droit — l'aperçu avant
 * sauvegarde, et les deux refus que l'écran annonce d'avance sur un rôle livré avec le produit.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, ToastStack } from '~/components/overlays'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient, renderComponent } from '~/test/render'
import { stubFetch } from '~/test/stub-fetch'
import { RolesScreen } from './roles-screen'

afterEach(() => {
  vi.unstubAllGlobals()
})

const ADMIN = {
  id: 'op-1',
  email: 'admin@example.test',
  displayName: 'Administratrice',
  permissions: ['roles:manage'],
  mfaCompleted: true,
}

const ROLES = {
  roles: [
    {
      id: 'role-1',
      name: 'auditor',
      description: 'Revue de conformité',
      isDefault: true,
      permissions: ['audit:read'],
      operatorCount: 3,
    },
    {
      id: 'role-2',
      name: 'support_n2',
      description: 'Support de second niveau',
      isDefault: false,
      permissions: ['sessions:read'],
      operatorCount: 0,
    },
  ],
}

/**
 * Le menu d'actions d'une ligne donnée.
 *
 * L'index plutôt qu'un nom : les deux déclencheurs portent le même libellé, et c'est voulu — ce qui
 * les distingue est la ligne qui les contient, que la table rend dans l'ordre du serveur.
 */
async function menuDeLaLigne(
  screen: ReturnType<typeof renderComponent>,
  index: number,
): Promise<HTMLElement> {
  const menus = await screen.findAllByRole('button', { name: 'Actions' })
  const menu = menus[index]
  if (!menu) throw new Error(`Aucun menu d'actions à la ligne ${index}.`)

  return menu
}

function renderScreen() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(OPERATOR_QUERY_KEY, ADMIN)

  return renderComponent(
    <ToastProvider>
      <RolesScreen />
      <ToastStack />
    </ToastProvider>,
    { queryClient },
  )
}

describe('l’éditeur d’un rôle', () => {
  it('annonce ce que le changement retire, et à combien de personnes', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/impact': {
        body: { removedPermissions: ['audit:read'], affectedOperators: 3 },
      },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 0))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Modifier le paquet' }))
    await screen.user.click(screen.getByRole('checkbox', { name: 'audit:read' }))

    // Le chiffre vient du serveur, sur le nombre réel de porteurs : c'est le seul de l'écran qui
    // doit faire hésiter.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'retire 1 permission(s) à 3 opérateur(s)',
    )
  })

  it('refuse de laisser renommer un rôle livré avec le produit', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/impact': { body: { removedPermissions: [], affectedOperators: 0 } },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 0))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Modifier le paquet' }))

    // Désactivé **et expliqué** : le seed réinsère ces rôles par nom, si bien qu'un rôle renommé
    // serait recréé au déploiement suivant — et l'installation en aurait deux.
    expect(screen.getByLabelText(/Nom du rôle/)).toBeDisabled()
    expect(screen.getByText(/ne peut pas changer/)).toBeInTheDocument()
  })

  it('enregistre un paquet et l’annonce', async () => {
    const calls = stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/impact': { body: { removedPermissions: [], affectedOperators: 0 } },
      '/api/admin/roles/update': { body: { added: ['alerts:read'], removed: [] } },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 0))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Modifier le paquet' }))
    await screen.user.click(screen.getByRole('checkbox', { name: 'alerts:read' }))
    await screen.user.click(screen.getByRole('button', { name: 'Enregistrer le paquet' }))

    expect(await screen.findByText('Rôle modifié.')).toBeInTheDocument()
    expect(calls).toContain('/api/admin/roles/update')
  })
})

describe('la création et la duplication', () => {
  it('pré-remplit une duplication avec le paquet du rôle source', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/create': { body: { roleId: 'role-3' } },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 0))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Dupliquer' }))

    // Un nom libre — le rôle source est livré, la copie ne l'est pas — et le paquet déjà coché :
    // dupliquer sert à partir d'un rôle existant, pas à tout recomposer.
    expect(screen.getByLabelText(/Nom du rôle/)).toHaveValue('auditor_copie')
    expect(screen.getByLabelText(/Nom du rôle/)).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'audit:read' })).toBeChecked()

    await screen.user.click(screen.getByRole('button', { name: 'Créer le rôle' }))
    expect(await screen.findByText('Rôle créé.')).toBeInTheDocument()
  })
})

describe('la création à partir de rien', () => {
  it('part d’un formulaire vide et sans aperçu — une création ne retire rien', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/create': { body: { roleId: 'role-4' } },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Créer un rôle' }))

    expect(screen.getByLabelText(/Nom du rôle/)).toHaveValue('')
    // Pas d'aperçu d'impact : un rôle qui n'existe pas encore n'enlève rien à personne, et
    // afficher « 0 permission retirée » ferait chercher un sens à un chiffre qui n'en a pas.
    expect(screen.queryByText(/Aperçu d’impact/)).not.toBeInTheDocument()

    await screen.user.type(screen.getByLabelText(/Nom du rôle/), 'astreinte_nuit')
    await screen.user.type(screen.getByLabelText(/Description/), 'Astreinte de nuit')
    await screen.user.click(screen.getByRole('checkbox', { name: 'sessions:read' }))
    await screen.user.click(screen.getByRole('button', { name: 'Créer le rôle' }))

    expect(await screen.findByText('Rôle créé.')).toBeInTheDocument()
  })

  it('garde un nom refusé sous les yeux, dans la modale', async () => {
    const refus = 'Nom refusé : un rôle nommé « ops » existe déjà.'

    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/create': { body: { error: refus }, status: 409 },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await screen.findByRole('button', { name: 'Créer un rôle' }))
    await screen.user.type(screen.getByLabelText(/Nom du rôle/), 'ops')
    await screen.user.type(screen.getByLabelText(/Description/), 'Doublon')
    await screen.user.click(screen.getByRole('button', { name: 'Créer le rôle' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(refus)
    // La composition en cours reste : corriger le nom ne doit pas obliger à tout recocher.
    expect(screen.getByLabelText(/Description/)).toHaveValue('Doublon')
  })
})

describe('les états de contenu', () => {
  it('explique une permission absente sans tenter la lecture', async () => {
    const calls = stubFetch({
      '/api/auth/me': { body: { ...ADMIN, permissions: [] } },
      '/api/admin/roles': { body: ROLES },
    })

    const queryClient = createTestQueryClient()
    queryClient.setQueryData(OPERATOR_QUERY_KEY, { ...ADMIN, permissions: [] })

    const screen = renderComponent(
      <ToastProvider>
        <RolesScreen />
      </ToastProvider>,
      { queryClient },
    )

    expect(await screen.findByText(/roles:manage/)).toBeInTheDocument()
    expect(calls.filter((url) => url.startsWith('/api/admin'))).toEqual([])
  })

  it('peint l’erreur avec sa réalité HTTP', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles': { body: { error: 'panne' }, status: 500 },
    })

    const screen = renderScreen()

    expect(await screen.findByRole('alert')).toHaveTextContent('500')
  })
})

describe('la suppression', () => {
  it('est désactivée et expliquée sur un rôle livré avec le produit', async () => {
    stubFetch({ '/api/auth/me': { body: ADMIN }, '/api/admin/roles': { body: ROLES } })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 0))

    // La raison est **dans le libellé** : un contrôle grisé sans explication envoie chercher un
    // contournement.
    //
    // `aria-disabled` et non `toBeDisabled()` : une entrée de menu Base UI est un `<div role=
    // "menuitem">`, pas un élément de formulaire — le matcher de jest-dom ne la voit donc pas comme
    // désactivée, alors que les technologies d'assistance, si.
    expect(
      await screen.findByRole('menuitem', { name: 'Supprimer — rôle livré avec le produit' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('dit ce que perdent les porteurs avant de supprimer un rôle personnalisé', async () => {
    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/delete': { body: { name: 'support_n2', holders: 0 } },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 1))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Supprimer le rôle' }))

    expect(screen.getByText(/perdent immédiatement/)).toBeInTheDocument()

    await screen.user.click(screen.getByRole('button', { name: 'Supprimer le rôle' }))
    expect(await screen.findByText('Rôle supprimé.')).toBeInTheDocument()
  })

  it('affiche en bandeau un refus venu du serveur', async () => {
    const refus =
      'Changement refusé : votre compte perdrait la permission « roles:manage », et plus personne ne pourrait vous la rendre depuis cet écran.'

    stubFetch({
      '/api/auth/me': { body: ADMIN },
      '/api/admin/roles/delete': { body: { error: refus }, status: 409 },
      '/api/admin/roles': { body: ROLES },
    })

    const screen = renderScreen()

    await screen.user.click(await menuDeLaLigne(screen, 1))
    await screen.user.click(await screen.findByRole('menuitem', { name: 'Supprimer le rôle' }))
    await screen.user.click(screen.getByRole('button', { name: 'Supprimer le rôle' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(refus)
  })
})
