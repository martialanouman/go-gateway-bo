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

import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PasskeyList } from '~/components/auth/enrollment'
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

/**
 * Le message que le BFF rend réellement (`ALREADY_ENROLLED_MESSAGE`, `src/server/auth/http.ts`).
 *
 * Recopié et non importé : ce fichier vit sous `src/routes/`, où la règle de l'invariant (d) interdit
 * de toucher `src/server/`. La copie peut donc dériver — mais elle dérive **moins** qu'une phrase
 * inventée, ce qu'était la version précédente : elle affirmait couvrir un message que la passerelle
 * ne produit pas, et masquait que l'écran peignait un refus en information neutre.
 */
const ALREADY_ENROLLED_MESSAGE =
  'Enrôlement refusé : un authentificateur est déjà associé à ce compte. Son remplacement passe par un administrateur.'

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const RECOVERY = ['ABCD-EFGH-1', 'ABCD-EFGH-2', 'ABCD-EFGH-3']

function pendingSession() {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, PARTIAL_OPERATOR)
  return client
}

/**
 * Une session complète : second facteur déjà franchi, l'opérateur vient **ajouter** un appareil.
 *
 * Le stub de `fetch` est remplacé en même temps que le cache, et ce n'est pas une redondance : le
 * client de test tient tout pour périmé et rafraîchit dès le montage. Amorcer une session complète
 * en laissant le stub par défaut rendre une session partielle la faisait basculer en pleine
 * interaction — les boutons de retrait se bloquaient, et trois tests échouaient pour une raison sans
 * rapport avec ce qu'ils vérifient.
 */
function completeSession() {
  const complete = { ...PARTIAL_OPERATOR, mfaCompleted: true }
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, complete)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(complete)),
  )
  return client
}

beforeEach(() => {
  startTotpEnrollment.mockReset()
  confirmTotpEnrollment.mockReset()
  registerPasskey.mockReset()
  revokePasskey.mockReset()
  listPasskeys.mockReset().mockResolvedValue({ outcome: 'listed', passkeys: [] })

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
    // historique, un journal de proxy et une capture d'écran ; un stockage de navigateur survit à
    // la fermeture de l'onglet.
    //
    // **Les trois dernières voies manquaient**, et c'étaient les plus probables : une mutation
    // ajoutant `sessionStorage.setItem(...)` et un attribut `data-*` ne faisait rougir personne. La
    // step annonce « le secret n'apparaît dans aucune sérialisation persistée » ; il faut donc
    // regarder les sérialisations, pas seulement l'URL.
    expect(window.location.href).not.toContain(SECRET)
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SECRET)
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET)
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET)

    // Le secret est **affiché**, donc présent dans le texte : ce qu'on interdit est qu'il vive dans
    // un attribut, où il survivrait à une capture du DOM ou à un outil de session replay.
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value, `${element.tagName}[${attribute.name}]`).not.toContain(SECRET)
      }
    }
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

  it('garde les codes quand l’opérateur passe sur l’autre onglet', async () => {
    // **Le geste que l'écran invite à faire, et qui détruisait le seul recours.** Base UI démonte le
    // panneau caché : l'état local qui portait les codes mourait avec lui, et ils ne sont conservés
    // nulle part ailleurs — le serveur n'en garde que des empreintes, et un second enrôlement est
    // refusé puisque le facteur est actif. L'accusé de réception ne gardait que la sortie par le
    // bouton, pas la sortie par l'onglet.
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

    // Les onglets ont disparu : il n'y a plus de geste qui puisse faire perdre les codes.
    expect(screen.queryByRole('tab', { name: /Passkey/i })).toBeNull()
    expect(screen.getByText(RECOVERY[0] as string)).toBeInTheDocument()
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

  it('rend le refus d’un compte déjà enrôlé, avec le message du serveur', async () => {
    // **Le message est celui du produit**, pas un texte inventé pour le test. Une version précédente
    // injectait « Un second facteur est déjà actif sur ce compte. », phrase qui n'existe nulle part,
    // et concluait que l'écran devait la peindre en information neutre. Le vrai message commence par
    // « Enrôlement refusé » : l'annoncer en `status` était une contradiction que l'opérateur lit d'un
    // coup d'œil.
    startTotpEnrollment.mockResolvedValue({
      outcome: 'already_enrolled',
      message: ALREADY_ENROLLED_MESSAGE,
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(ALREADY_ENROLLED_MESSAGE)
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
    expect(await screen.findByRole('listitem')).toHaveTextContent('Poste de test')

    // **La cérémonie promeut la session côté serveur**, et cet écran vit hors de la coquille : sans
    // sortie explicite, l'opérateur se retrouvait avec une session complète et aucun moyen d'entrer
    // — ni rail, ni lien. Le cul-de-sac que cette step supprime se reformait sur cet onglet.
    expect(screen.getByRole('button', { name: /Continuer vers la console/ })).toBeInTheDocument()
  })

  it('nomme l’appareil dans le bouton qui le retire', async () => {
    listPasskeys.mockResolvedValue({
      outcome: 'listed',
      passkeys: [
        { id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' },
        { id: 'c2', name: 'Portable', createdAt: '2026-07-31T00:00:00Z' },
      ],
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))

    // Trois boutons « Retirer » identiques ne disent pas lequel on s'apprête à supprimer — et le
    // geste est irréversible.
    expect(await screen.findByRole('button', { name: /Retirer Portable/ })).toBeInTheDocument()
  })

  it('n’offre pas le retrait depuis une session partielle, et dit pourquoi', async () => {
    listPasskeys.mockResolvedValue({
      outcome: 'listed',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))

    // **Le point d'entrée de gestion exige une session complète** et répond sinon 401 « Session
    // absente ou expirée » : offrir le bouton faisait annoncer une expiration à un opérateur dont la
    // session est parfaitement valide, et il se reconnectait pour rien.
    const remove = await screen.findByRole('button', { name: /Retirer/ })
    expect(remove).toHaveAttribute('aria-disabled', 'true')

    await screen.user.click(remove)
    expect(revokePasskey).not.toHaveBeenCalled()
    expect(screen.getByText(/demande une session complète/)).toBeInTheDocument()
  })

  it('dit pourquoi le dernier facteur ne se retire pas', async () => {
    listPasskeys.mockResolvedValue({
      outcome: 'listed',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
    })
    revokePasskey.mockResolvedValue({
      outcome: 'refused',
      message: 'Retrait refusé : cet appareil est votre dernier second facteur.',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(await screen.findByRole('button', { name: /Retirer/ }))

    // Le refus qui protège l'opérateur de lui-même : retirer son dernier facteur le laisserait
    // dehors. Le message dit pourquoi, pas « échec ».
    expect(await screen.findByRole('alert')).toHaveTextContent('dernier second facteur')
  })

  it('retire un appareil et le fait disparaître de la liste', async () => {
    listPasskeys.mockResolvedValue({
      outcome: 'listed',
      passkeys: [
        { id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' },
        { id: 'c2', name: 'Portable', createdAt: '2026-07-31T00:00:00Z' },
      ],
    })
    revokePasskey.mockResolvedValue({
      outcome: 'updated',
      passkeys: [{ id: 'c2', name: 'Portable', createdAt: '2026-07-31T00:00:00Z' }],
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(await screen.findByRole('button', { name: /Retirer Poste/ }))

    // La liste vient du serveur, pas d'un retrait local : deux sources finiraient par diverger, et
    // c'est l'affichage qui mentirait sur ce qui protège réellement le compte.
    await vi.waitFor(() => {
      expect(screen.queryByText('Poste')).toBeNull()
    })
    expect(screen.getByText('Portable')).toBeInTheDocument()
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

describe('la sortie vers la console', () => {
  it('relit la session avant de partir, et emmène l’opérateur', async () => {
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: 'otpauth://x',
    })
    confirmTotpEnrollment.mockResolvedValue({ outcome: 'activated', recoveryCodes: RECOVERY })

    // `/auth/me` répond ce qu'il répondrait après l'activation : une session **complète**. Sans
    // relecture, la coquille garderait l'opérateur sans permission lu avant l'enrôlement, et la
    // garde le renverrait ici — la boucle que `connexion.verification.tsx` a déjà connue.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: true })),
    )

    // **Le client reproduit la fraîcheur de production**, et c'est ce qui rend ce test discriminant.
    // Avec le `staleTime` de zéro du harnais, la requête se rafraîchit d'elle-même à chaque rendu :
    // le test passait donc même sans la relecture explicite, ce qu'une mutation a établi. Avec
    // trente secondes, seule une relecture demandée change la réponse.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    client.setQueryData(OPERATOR_QUERY_KEY, PARTIAL_OPERATOR)

    const screen = await renderRoute('/connexion/enrolement', { queryClient: client })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.user.type(await screen.findByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Confirmer/ }))
    await screen.findByText(RECOVERY[0] as string)

    await screen.user.click(screen.getByRole('checkbox', { name: /J’ai noté ces codes/ }))
    await screen.user.click(screen.getByRole('button', { name: /Continuer vers la console/ }))

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Tableau de bord')
  })
})

describe('la garde de l’écran', () => {
  it('montre un squelette tant que la session n’est pas connue', async () => {
    // Peindre le formulaire avant de savoir **pour qui** enrôler laisserait un visiteur préparer un
    // secret qui ne serait attaché à aucun compte.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const screen = await renderRoute('/connexion/enrolement', {
      queryClient: createTestQueryClient(),
    })

    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: /Préparer/ })).toBeNull()
  })

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

describe('l’écran ouvert depuis la console', () => {
  it('s’adresse à qui a déjà un facteur, et sait revenir', async () => {
    // **Deux publics, deux copies.** Le lien de la barre amène ici quelqu'un dont la console est
    // déjà ouverte : lui servir « un second facteur est requis pour ouvrir la console » lui ferait
    // croire qu'il a perdu son accès. Et ce cadre n'a ni rail ni barre — sans lien de retour, la
    // porte était à sens unique et seul le bouton du navigateur en sortait.
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    expect(screen.getByText(/Ajoutez un facteur à ce compte/)).toBeInTheDocument()
    expect(screen.queryByText(/requis pour ouvrir la console/)).toBeNull()

    // **Elle ne renvoie plus vers un administrateur pour l'ajout.** Une version précédente disait
    // « le remplacer passe par un administrateur » : faux pour qui n'a qu'une passkey —
    // `noOtherFactorFrom` dispense une session active de toute exclusion, et le serveur a un test
    // dédié pour l'ajout d'un TOTP à côté d'une passkey.
    //
    // Elle dit en revanche **ce qui se retire** : un appareil, en libre-service tant qu'il reste un
    // facteur ; une application authenticator, non — aucun point d'entrée ne le permet, et
    // `ALREADY_ENROLLED_MESSAGE` renvoie à un administrateur. « En retirer un » sans préciser lequel
    // laissait chercher un contrôle qui n'existe pas.
    expect(
      screen.getByText(/retirer un appareil tant qu’il vous reste un facteur/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/application\s+authenticator, lui, passe par un administrateur/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Revenir à la console/ })).toHaveAttribute('href', '/')
  })

  it('ouvre sur l’onglet qui peut aboutir', async () => {
    // L'onglet TOTP mènerait au bouton primaire « Préparer l'enrôlement », que le serveur refuse en
    // 409 quand un facteur existe déjà. On ouvre celui qui peut aboutir.
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    expect(screen.getByRole('tab', { name: /Passkey/i })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('ce que les onglets et la cérémonie conservent', () => {
  it('ne perd pas un code à moitié tapé quand l’opérateur change d’onglet', async () => {
    // **Ce que `keepMounted` protège.** Base UI démonte le panneau caché : un aller-retour d'onglet
    // effaçait la saisie en cours, et le message qui expliquait pourquoi le code précédent avait été
    // refusé.
    startTotpEnrollment.mockResolvedValue({
      outcome: 'started',
      secret: SECRET,
      uri: 'otpauth://x',
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Préparer/ }))
    await screen.user.type(await screen.findByLabelText(/Code à 6 chiffres/), '123')

    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(screen.getByRole('tab', { name: /authenticator/i }))

    expect(screen.getByLabelText(/Code à 6 chiffres/)).toHaveValue('123')
  })

  it('relit la session après la cérémonie, ce qui débloque le retrait', async () => {
    // La cérémonie promeut la session côté serveur. Sans relecture, `canRemove` restait figé sur le
    // cache d'avant : les boutons de retrait restaient bloqués sous une explication devenue fausse.
    registerPasskey.mockResolvedValue({
      outcome: 'registered',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
    })

    let completed = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: completed })),
    )

    const screen = await renderRoute('/connexion/enrolement', { queryClient: pendingSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')

    completed = true
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    // Le succès s'annonce — troisième transition de l'écran, longtemps la seule restée muette.
    expect(await screen.findByRole('heading', { name: 'Appareil enregistré' })).toBeInTheDocument()

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Retirer Poste/ })).not.toHaveAttribute(
        'aria-disabled',
      )
    })
    expect(screen.queryByText(/demande une session complète/)).toBeNull()
  })

  it('relit la liste quand le retrait ne la renvoie pas', async () => {
    listPasskeys
      .mockResolvedValueOnce({
        outcome: 'listed',
        passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
      })
      .mockResolvedValue({ outcome: 'listed', passkeys: [] })
    revokePasskey.mockResolvedValue({ outcome: 'updated' })

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(await screen.findByRole('button', { name: /Retirer Poste/ }))

    // Garder la liste précédente afficherait un appareil qu'on vient de supprimer, et un second clic
    // répondrait « cet appareil n'est pas enregistré ».
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /Retirer Poste/ })).toBeNull()
    })
  })
})

describe('ce que l’enregistrement verrouille pendant qu’il travaille', () => {
  it('ne laisse pas relancer une cérémonie pendant la relecture de la liste', async () => {
    // **Corriger `busy` d'un seul côté a ouvert le trou de l'autre.** Au retrait, un relâchement
    // anticipé coûtait un message d'erreur ; ici il coûte un facteur : le bouton redevenait actif, le
    // champ portait encore le nom, rien n'annonçait le succès — et un second clic relançait une
    // cérémonie WebAuthn complète, enrôlant un second appareil sous le même nom.
    registerPasskey.mockResolvedValue({ outcome: 'registered' })

    let release: ((value: PasskeyList) => void) | undefined
    listPasskeys.mockResolvedValueOnce({ outcome: 'listed', passkeys: [] }).mockImplementationOnce(
      () =>
        new Promise<PasskeyList>((resolve) => {
          release = resolve
        }),
    )

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    const button = screen.getByRole('button', { name: /Enregistrement en cours/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await screen.user.click(button)
    expect(registerPasskey).toHaveBeenCalledTimes(1)

    release?.({ outcome: 'listed', passkeys: [{ id: 'c1', name: 'Poste', createdAt: 'x' }] })
    expect(await screen.findByRole('button', { name: /Retirer Poste/ })).toBeInTheDocument()
  })

  it('ne laisse pas relancer un retrait pendant la relecture de la liste', async () => {
    // Le pendant du test précédent, côté retrait. Le relâchement anticipé laissait l'appareil
    // supprimé affiché avec un bouton actif : un second clic partait sur un identifiant déjà retiré,
    // et le serveur répondait « cet appareil n'est pas enregistré » — une alerte pour un geste que
    // l'interface avait laissé passer.
    revokePasskey.mockResolvedValue({ outcome: 'updated' })

    let release: ((value: PasskeyList) => void) | undefined
    listPasskeys
      .mockResolvedValueOnce({
        outcome: 'listed',
        passkeys: [{ id: 'c1', name: 'Poste', createdAt: 'x' }],
      })
      .mockImplementationOnce(
        () =>
          new Promise<PasskeyList>((resolve) => {
            release = resolve
          }),
      )

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))

    const remove = await screen.findByRole('button', { name: /Retirer Poste/ })
    await screen.user.click(remove)

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Retirer Poste/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })

    await screen.user.click(screen.getByRole('button', { name: /Retirer Poste/ }))
    expect(revokePasskey).toHaveBeenCalledTimes(1)

    release?.({ outcome: 'listed', passkeys: [] })
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /Retirer Poste/ })).toBeNull()
    })
  })

  it('n’annonce occupés que les gestes qui le sont', async () => {
    // **Un booléen partagé désignait la mauvaise action.** Avec trois appareils, retirer « Poste »
    // posait `aria-busy` sur les trois boutons, et une cérémonie d'enregistrement — qui peut durer
    // une minute sur une attente d'empreinte — annonçait occupés des retraits qui ne tournaient pas.
    // Un lecteur d'écran ne pouvait pas dire lequel était en cours.
    revokePasskey.mockReturnValue(new Promise(() => {}))
    listPasskeys.mockResolvedValue({
      outcome: 'listed',
      passkeys: [
        { id: 'c1', name: 'Poste', createdAt: 'x' },
        { id: 'c2', name: 'Portable', createdAt: 'x' },
      ],
    })

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.click(await screen.findByRole('button', { name: /Retirer Poste/ }))

    expect(screen.getByRole('button', { name: /Retirer Poste/ })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('button', { name: /Retirer Portable/ })).not.toHaveAttribute(
      'aria-busy',
    )
  })

  it('annonce le succès sans attendre la relecture de la liste', async () => {
    // `listPasskeys` n'a ni délai ni signal d'annulation : le temps qu'elle traîne, la cérémonie a
    // réussi et promu la session côté serveur, mais l'écran ne montrait ni « Appareil enregistré »
    // ni la sortie vers la console. Le cul-de-sac que cette step supprime se reformait le temps
    // d'un aller-retour.
    registerPasskey.mockResolvedValue({ outcome: 'registered' })
    listPasskeys
      .mockResolvedValueOnce({ outcome: 'listed', passkeys: [] })
      .mockReturnValue(new Promise(() => {}))

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    expect(await screen.findByRole('heading', { name: 'Appareil enregistré' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continuer vers la console/ })).toBeInTheDocument()
  })

  it('relit la liste quand l’enregistrement ne la renvoie pas', async () => {
    // Garder la liste précédente ne suffit pas : quand elle est vide — le cas du premier appareil —
    // l'écran annonçait « Appareil enregistré » au-dessus de zéro ligne, sans rien qui dise que
    // l'appareil existe.
    registerPasskey.mockResolvedValue({ outcome: 'registered' })
    listPasskeys.mockResolvedValueOnce({ outcome: 'listed', passkeys: [] }).mockResolvedValue({
      outcome: 'listed',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: 'x' }],
    })

    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })
    await screen.user.click(screen.getByRole('tab', { name: /Passkey/i }))
    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    expect(await screen.findByRole('button', { name: /Retirer Poste/ })).toBeInTheDocument()
  })
})

describe('la liste des appareils', () => {
  it('dit son indisponibilité, puis se tait quand elle redevient lisible', async () => {
    // **Le défaut du premier correctif** : l'indisponibilité vivait dans un état séparé qui n'était
    // jamais remis à zéro. Après un enregistrement réussi, l'écran affichait la liste **et**, juste
    // au-dessus, « la liste n'a pas pu être lue » — l'ambiguïté qu'on voulait lever, reconduite.
    listPasskeys.mockResolvedValue({ outcome: 'unavailable' })
    registerPasskey.mockResolvedValue({
      outcome: 'registered',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
    })
    const screen = await renderRoute('/connexion/enrolement', { queryClient: completeSession() })

    expect(await screen.findByText(/n’a pas pu être lue/)).toBeInTheDocument()

    await screen.user.type(screen.getByLabelText(/Nom de l’appareil/), 'Poste')
    await screen.user.click(screen.getByRole('button', { name: /Enregistrer cet appareil/ }))

    await vi.waitFor(() => {
      expect(screen.queryByText(/n’a pas pu être lue/)).toBeNull()
    })
    expect(screen.getByRole('button', { name: /Retirer Poste/ })).toBeInTheDocument()
  })
})
