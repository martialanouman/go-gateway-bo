/**
 * Le challenge du second facteur — **passkey d'abord, TOTP en repli**.
 *
 * L'ordre n'est pas un goût. La passkey résiste au hameçonnage parce que le navigateur refuse de
 * signer pour une autre origine ; un code TOTP se recopie dans un faux formulaire. La charte du kit
 * met donc la passkey en premier onglet, et le TOTP en second.
 *
 * Le cas qui décide de l'écran est le troisième test : **aucun appareil enregistré** n'est pas un
 * refus. Le traiter comme tel laisserait un opérateur cliquer indéfiniment sur un bouton qui ne peut
 * pas aboutir.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient } from '~/test/render'
import { renderRoute } from '~/test/render-route'

const { verifyPasskey, verifyTotp } = vi.hoisted(() => ({
  verifyPasskey: vi.fn(),
  verifyTotp: vi.fn(),
}))
vi.mock('~/components/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/components/auth/api')>()),
  verifyPasskey,
  verifyTotp,
}))

beforeEach(() => {
  verifyPasskey.mockReset()
  verifyTotp.mockReset()
})

/** Une session partielle : l'opérateur est identifié, son second facteur reste à franchir. */
function pendingSession() {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, {
    id: 'op-1',
    email: 'operatrice@example.test',
    displayName: 'Opératrice',
    permissions: [],
    mfaCompleted: false,
  })
  return client
}

describe('le challenge du second facteur', () => {
  it('ouvre sur la passkey, avec le TOTP disponible', async () => {
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Vérification en deux étapes',
    )

    // Premier onglet sélectionné : la passkey résiste au hameçonnage, le code TOTP se recopie dans
    // un faux formulaire. L'ordre des onglets est l'ordre des recommandations.
    expect(screen.getByRole('tab', { name: /Passkey/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /TOTP/ })).toBeInTheDocument()
  })

  it('mène à la console quand la passkey passe', async () => {
    verifyPasskey.mockResolvedValue({ outcome: 'completed' })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    // La session devient complète côté serveur ; le cache local doit être réinterrogé, sinon la
    // coquille garderait l'opérateur sans permission qu'elle a lu avant la cérémonie.
    await vi.waitFor(() => {
      expect(screen.queryByRole('tab', { name: /Passkey/ })).toBeNull()
    })
  })

  it('bascule sur le TOTP quand aucun appareil n’est enregistré', async () => {
    verifyPasskey.mockResolvedValue({
      outcome: 'no_passkey',
      message: 'Aucun appareil enregistré sur ce compte.',
    })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    // **Ce n'est pas un refus.** L'écran dit la conduite à tenir et amène l'opérateur là où il peut
    // aboutir, au lieu de le laisser réessayer un facteur qu'il n'a pas.
    expect(await screen.findByRole('tab', { name: /TOTP/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('status')).toHaveTextContent('Aucun appareil enregistré sur ce compte.')
  })

  it('vérifie le code TOTP', async () => {
    verifyTotp.mockResolvedValue({ outcome: 'completed' })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /TOTP/ }))
    await screen.user.type(screen.getByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Vérifier/ }))

    expect(verifyTotp).toHaveBeenCalledWith('123456')
  })

  it('affiche le refus de code sans dire s’il était le bon', async () => {
    verifyTotp.mockResolvedValue({
      outcome: 'refused',
      message: 'Vérification refusée : code incorrect ou expiré.',
    })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /TOTP/ }))
    await screen.user.type(screen.getByLabelText(/Code à 6 chiffres/), '000000')
    await screen.user.click(screen.getByRole('button', { name: /^Vérifier/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vérification refusée : code incorrect ou expiré.',
    )
  })

  it('traite l’abandon de la cérémonie autrement qu’une panne', async () => {
    verifyPasskey.mockResolvedValue({
      outcome: 'cancelled',
      message: 'Vérification interrompue : l’appareil n’a pas confirmé.',
    })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    // Fermer la fenêtre système n'est pas une erreur. Peindre une alerte rouge à chaque hésitation
    // apprendrait à l'opérateur à ignorer les alertes rouges.
    expect(await screen.findByRole('status')).toHaveTextContent('Vérification interrompue')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('nomme l’opérateur en cours d’authentification', async () => {
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    // La session partielle sait qui s'authentifie. Le dire évite qu'un opérateur devant deux
    // consoles vérifie le mauvais compte — et cela ne révèle rien : il vient de donner ce mot de
    // passe.
    expect(screen.getByText('operatrice@example.test')).toBeInTheDocument()
  })

  it('renvoie au login quand il n’y a aucune session à compléter', async () => {
    const empty = createTestQueryClient()
    empty.setQueryData(OPERATOR_QUERY_KEY, null)

    const screen = await renderRoute('/connexion/verification', { queryClient: empty })

    // Sans session partielle, il n'y a rien à vérifier : rester ici afficherait un formulaire dont
    // aucune soumission ne peut aboutir.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Connexion opérateur',
    )
  })

  it('dit quoi faire quand aucun facteur n’est enrôlé', async () => {
    verifyPasskey.mockResolvedValue({
      outcome: 'no_passkey',
      message: 'Aucun appareil enregistré sur ce compte.',
    })
    verifyTotp.mockResolvedValue({
      outcome: 'refused',
      message: 'Vérification refusée : code incorrect ou expiré.',
    })
    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    // Un opérateur tout juste amorcé n'a ni appareil ni application : le produit lui doit une
    // conduite à tenir, pas un formulaire qui refuse. L'écran d'enrôlement arrive en step-028 ; d'ici
    // là, l'écran nomme la marche à suivre au lieu d'être un cul-de-sac.
    expect(screen.getByText(/Aucun second facteur enrôlé/)).toBeInTheDocument()
  })
})
