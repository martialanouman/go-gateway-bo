/**
 * L'écran d'enrôlement du second facteur.
 *
 * ## Ce que cet écran débloque
 *
 * La step-025 a rendu le second facteur obligatoire, et `installFirstAdministrator` crée le premier
 * administrateur sans en poser aucun. Sans cet écran, ce compte-là ne pouvait **jamais** entrer :
 * connexion, arrivée au challenge, ni passkey ni TOTP, aucun recours. C'est le seul écran du produit
 * dont l'absence rendait le reste inaccessible.
 *
 * ## L'invariant (b) gouverne la moitié des tests
 *
 * Le secret TOTP et les codes de récupération sont montrés **exactement une fois**. Aucun réaffichage,
 * aucune action « révéler », et surtout : jamais dans le cache Query, jamais dans une URL, jamais
 * dans une sérialisation. Un opérateur qui quitte l'écran les a perdus — c'est voulu, et c'est
 * pourquoi il doit accuser réception avant de partir.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient } from '~/test/render'
import { renderRoute } from '~/test/render-route'

const { confirmTotpEnrollment, listPasskeys, registerPasskey, revokePasskey, startTotpEnrollment } =
  vi.hoisted(() => ({
    confirmTotpEnrollment: vi.fn(),
    listPasskeys: vi.fn(),
    registerPasskey: vi.fn(),
    revokePasskey: vi.fn(),
    startTotpEnrollment: vi.fn(),
  }))
vi.mock('~/components/auth/enrollment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/components/auth/enrollment')>()),
  confirmTotpEnrollment,
  listPasskeys,
  registerPasskey,
  revokePasskey,
  startTotpEnrollment,
}))

/** L'opérateur qui vient de donner son mot de passe et n'a encore aucun facteur. */
const PARTIAL_OPERATOR = {
  id: 'op-1',
  email: 'operatrice@example.test',
  displayName: 'Opératrice',
  permissions: [],
  mfaCompleted: false,
} as const

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const RECOVERY = ['ABCD-EFGH-1', 'ABCD-EFGH-2', 'ABCD-EFGH-3']

function pendingSession() {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, PARTIAL_OPERATOR)
  return client
}

beforeEach(() => {
  startTotpEnrollment.mockReset()
  confirmTotpEnrollment.mockReset()
  registerPasskey.mockReset()
  revokePasskey.mockReset()
  listPasskeys.mockReset().mockResolvedValue([])

  // Aucun test ne touche le réseau, et le rafraîchissement dit la même chose que le cache : sinon
  // l'écran basculerait en pleine interaction, et le test échouerait pour une raison sans rapport.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(PARTIAL_OPERATOR)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('l’écran d’enrôlement', () => {
  it('ouvre sur l’application authenticator, la passkey en second', async () => {
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Second facteur')

    // **L'ordre s'inverse par rapport au challenge**, et c'est délibéré. À la vérification, la
    // passkey passe d'abord : elle résiste au hameçonnage. À l'enrôlement, c'est l'application
    // authenticator qui passe d'abord, parce qu'elle marche partout — un opérateur sur un poste sans
    // authentificateur intégré doit pouvoir entrer, et c'est précisément ce compte-là qui est bloqué
    // dehors aujourd'hui.
    expect(screen.getByRole('tab', { name: /authenticator/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('ne prépare rien tant que l’opérateur ne le demande pas', async () => {
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    // Préparer d'office consommerait un secret à chaque ouverture de l'onglet, et **écraserait**
    // l'enrôlement en cours de celui qui a déjà scanné son QR code sans confirmer.
    expect(startTotpEnrollment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Préparer/ })).toBeInTheDocument()
  })

  it('montre le QR code et le secret, une seule fois', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: `otpauth://totp/SMS%20Gateway:operatrice?secret=${SECRET}`,
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))

    // Le QR porte un nom accessible : sans lui, un lecteur d'écran annonce « image » et l'opérateur
    // ne sait pas quoi en faire — or c'est lui qui doit lire le secret en clair juste à côté.
    expect(await screen.findByRole('img', { name: /QR code/i })).toBeInTheDocument()
    expect(screen.getByText(SECRET)).toBeInTheDocument()
  })

  it('ne laisse le secret ni dans l’URL ni dans le cache', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: `otpauth://totp/x?secret=${SECRET}`,
    })
    const client = pendingSession()
    const screen = await renderRoute('/connexion/enrolement', { queryClient: client })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.findByText(SECRET)

    // **Invariant (b).** Le secret vit dans un état local, il traverse le composant et disparaît
    // avec lui. Le cache Query peut être persisté ou inspecté ; une URL se retrouve dans un
    // historique, un journal de proxy et une capture d'écran.
    expect(window.location.href).not.toContain(SECRET)
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SECRET)
  })

  it('montre les codes de récupération après confirmation, et exige un accusé', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: 'otpauth://x',
    })
    confirmTotpEnrollment.mockResolvedValue({ outcome: 'activated', recoveryCodes: RECOVERY })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.user.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Confirmer/ }))

    for (const code of RECOVERY) {
      expect(await screen.findByText(code)).toBeInTheDocument()
    }

    // **L'accusé n'est pas une politesse.** Ces codes ne seront jamais réaffichés : sans lui, un
    // opérateur qui clique trop vite les perd définitivement, et c'est son seul recours le jour où
    // il perd son téléphone.
    expect(screen.getByRole('button', { name: /Continuer/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await screen.user.click(screen.getByRole('checkbox', { name: /notés|conservés/i }))
    expect(screen.getByRole('button', { name: /Continuer/ })).not.toHaveAttribute('aria-disabled')
  })

  it('n’offre aucun moyen de revoir les codes', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: 'otpauth://x',
    })
    confirmTotpEnrollment.mockResolvedValue({ outcome: 'activated', recoveryCodes: RECOVERY })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.user.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Confirmer/ }))
    await screen.findByText(RECOVERY[0] as string)

    // « Aucune action *révéler* n'existe nulle part » — règle d'or du dépôt. Un bouton qui
    // réafficherait des codes supposerait de les avoir gardés quelque part.
    expect(screen.queryByRole('button', { name: /Révéler|Afficher|Voir/i })).toBeNull()
  })

  it('relance l’enrôlement plutôt que d’insister quand il a expiré', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: 'otpauth://x',
    })
    confirmTotpEnrollment.mockResolvedValue({
      outcome: 'expired',
      message: 'Aucun enrôlement en cours : relancez l’enrôlement pour obtenir un nouveau QR code.',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.user.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Confirmer/ }))

    // Le secret affiché ne vaut plus rien : laisser le champ de code ouvert inviterait à retaper
    // indéfiniment un code que le serveur ne peut plus vérifier.
    expect(await screen.findByRole('alert')).toHaveTextContent(/relancez l’enrôlement/)
    expect(screen.getByRole('button', { name: /Préparer/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Code à 6 chiffres/)).toBeNull()
  })

  it('dit qu’un facteur existe déjà, sans parler d’échec', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'already_enrolled',
      message: 'Un second facteur est déjà actif sur ce compte.',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))

    // Ce n'est pas un refus : le compte est en règle. Le peindre en alerte apprendrait à ignorer les
    // alertes.
    expect(await screen.findByRole('status')).toHaveTextContent('déjà actif')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('l’enrôlement d’une passkey', () => {
  it('exige un nom d’appareil avant la cérémonie', async () => {
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))

    // Un appareil sans nom est indistinguable des autres dans la liste : le jour où il faut en
    // retirer un, l'opérateur ne sait pas lequel.
    expect(screen.getByRole('button', { name: /Enregistrer cet appareil/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste de test')
    expect(screen.getByRole('button', { name: /Enregistrer cet appareil/ })).not.toHaveAttribute(
      'aria-disabled',
    )
  })

  it('enregistre l’appareil et le montre dans la liste', async () => {
    registerPasskey.mockResolvedValue({
      outcome: 'registered',
      passkeys: [{ id: 'c1', name: 'Poste de test', createdAt: '2026-07-31T00:00:00Z' }],
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste de test')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    expect(registerPasskey).toHaveBeenCalledWith('Poste de test')
    expect(await screen.findByText('Poste de test')).toBeInTheDocument()
  })

  it('dit pourquoi le dernier facteur ne se retire pas', async () => {
    listPasskeys.mockResolvedValue([{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }])
    revokePasskey.mockResolvedValue({
      outcome: 'refused',
      message: 'Retrait refusé : cet appareil est votre dernier second facteur.',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(await screen.findByRole('button', { name: /Retirer/ }))

    // Le refus qui protège l'opérateur de lui-même : retirer son dernier facteur le laisserait
    // dehors. Le message dit pourquoi, pas « échec ».
    expect(await screen.findByRole('alert')).toHaveTextContent('dernier second facteur')
  })

  it('traite l’abandon de la cérémonie autrement qu’une panne', async () => {
    registerPasskey.mockResolvedValue({
      outcome: 'cancelled',
      message: 'Enregistrement interrompu : l’appareil n’a pas confirmé.',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('interrompu')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('la garde de l’écran', () => {
  it('renvoie au login un visiteur sans session', async () => {
    const empty = createTestQueryClient()
    empty.setQueryData(OPERATOR_QUERY_KEY, null)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

    const screen = await renderRoute('/connexion/enrolement', { queryClient: empty })

    // Enrôler suppose de savoir **pour qui**. Une session partielle suffit — c'est la règle des
    // points d'entrée depuis la step-023 — mais l'absence de session, non.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Connexion opérateur',
    )
  })
})
