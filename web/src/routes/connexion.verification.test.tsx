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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  // **Aucun test ne touche le réseau, et le rafraîchissement dit la même chose que le cache.** Le
  // client de test tient tout pour périmé et rafraîchit dès le montage : sans ce stub, chaque écran
  // lançait un vrai `fetch('/api/auth/me')` que jsdom laisse en suspens. Et un stub qui répondrait
  // autre chose que la session amorcée ferait basculer l'écran en pleine interaction — un test qui
  // échoue alors pour une raison qui n'a rien à voir avec ce qu'il vérifie. Les tests qui attendent
  // une **transition** de session remplacent ce stub.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(PARTIAL_OPERATOR)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** L'opérateur en cours d'authentification : identifié, sans permission, second facteur à franchir. */
const PARTIAL_OPERATOR = {
  id: 'op-1',
  email: 'operatrice@example.test',
  displayName: 'Opératrice',
  permissions: [],
  mfaCompleted: false,
} as const

/** Une session partielle, déjà en cache. */
function pendingSession() {
  const client = createTestQueryClient()
  client.setQueryData(OPERATOR_QUERY_KEY, PARTIAL_OPERATOR)
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

    // `/auth/me` répond ce qu'il répondrait après la cérémonie : une session **complète**. Sans ce
    // stub, la relecture échouait, le cache gardait la session partielle, et l'écran n'allait nulle
    // part.
    //
    // Les permissions sont laissées vides **délibérément**, et cela mérite d'être dit : donner un
    // droit ferait rebondir la racine vers un écran de la coquille, et monter la coquille entière
    // depuis ce fichier bloque le runner — sans message, sans dépassement de délai. La cause n'est
    // pas identifiée ; elle ne se manifeste pas depuis `_shell.test.tsx`, qui monte la même coquille
    // et passe. Ce qui compte ici est la **destination**, et `/` en est une : c'est ce que ce test
    // vérifie. L'arrivée effective dans la console est couverte par `_shell.test.tsx` et par
    // `e2e/passkey.spec.ts`, qui la traverse dans un vrai navigateur.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'op-1',
          email: 'operatrice@example.test',
          displayName: 'Opératrice',
          permissions: [],
          mfaCompleted: true,
        }),
      ),
    )

    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    // **La destination, pas la disparition.** Une version précédente n'assertait que l'absence de
    // l'onglet passkey : elle était vraie si l'écran menait à la console, mais tout autant s'il
    // repartait au login, rendait `null`, ou levait. Le titre de la racine, lui, ne s'obtient que
    // par le bon chemin.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Tableau de bord')
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

  it('dit quand le facteur est acquis mais la console injoignable', async () => {
    // **Le chemin muet, et il était réel.** La cérémonie réussit côté serveur, la relecture de
    // session échoue, et l'écran se re-rendait à l'identique : même formulaire, aucune annonce,
    // `notice` remis à zéro au début de la tentative. L'opérateur recommençait une vérification déjà
    // acquise en se demandant pourquoi rien ne changeait.
    verifyPasskey.mockResolvedValue({ outcome: 'completed' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )

    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })

    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Second facteur accepté/)

    // **La reprise porte sur la relecture, pas sur la vérification.** Le serveur a déjà promu la
    // session : les points d'entrée du second facteur n'acceptent plus qu'une session `pending_mfa`
    // et répondraient 401 « Session absente ou expirée ». Envoyer l'opérateur relancer une cérémonie
    // — ce que faisait le message précédent — lui faisait lire « acquise » puis « expirée », sans
    // autre issue qu'un rechargement de page.
    expect(screen.getByRole('button', { name: /Ouvrir la console/ })).toBeInTheDocument()
    expect(alert.textContent).not.toMatch(/Réessayez dans un instant/)

    // **Et les onglets ne peuvent plus détruire cette sortie.** Le serveur a promu la session : une
    // nouvelle cérémonie répondrait 401 « Session absente ou expirée » — un refus faux sur une
    // session valide — et ce refus **effaçait** le bouton menant à la console. Un contrôle qui ne
    // peut plus aboutir est désactivé et expliqué, jamais laissé actif.
    const passkey = screen.getByRole('button', { name: /Utiliser la passkey/ })
    expect(passkey).toHaveAttribute('aria-disabled', 'true')
    expect(passkey.getAttribute('aria-describedby')).toBe(alert.id)

    await screen.user.click(passkey)
    expect(verifyPasskey).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Ouvrir la console/ })).toBeInTheDocument()
  })

  it('rouvre la console sur ce bouton, sans relancer la cérémonie', async () => {
    verifyPasskey.mockResolvedValue({ outcome: 'completed' })

    let reachable = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        reachable
          ? Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: true })
          : new Response('nope', { status: 502 }),
      ),
    )

    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })
    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))
    await screen.findByRole('alert')

    reachable = true
    await screen.user.click(screen.getByRole('button', { name: /Ouvrir la console/ }))

    // La console s'ouvre, et `verifyPasskey` n'a été appelé qu'une fois : la cérémonie n'est pas
    // rejouée, elle serait refusée.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Tableau de bord')
    expect(verifyPasskey).toHaveBeenCalledTimes(1)
  })

  it('garde le bouton fermé pendant la relecture', async () => {
    // **Le correctif « troisième porte », qui n'était gardé par rien.** Relâcher `busy` avant la
    // relecture rouvrait le bouton pendant l'aller-retour `/auth/me`, reprise comprise, sans qu'un
    // message n'accompagne l'attente : un second clic relançait une cérémonie complète.
    verifyPasskey.mockResolvedValue({ outcome: 'completed' })

    let respond: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve
          }),
      ),
    )

    const screen = await renderRoute('/connexion/verification', { queryClient: pendingSession() })
    await screen.user.click(screen.getByRole('button', { name: /Utiliser la passkey/ }))

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Vérification en cours/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    })

    respond?.(Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: true }))
  })

  it('relit vraiment la session, sans rejoindre une requête déjà en vol', async () => {
    // **La déduplication de TanStack Query, et pourquoi `fetchQuery` ne suffisait pas.** Une
    // relecture de fond partie avant la cérémonie — la fenêtre reprend le focus après la boîte de
    // dialogue système, ou la fraîcheur de trente secondes est écoulée — était rejointe par
    // `fetchQuery`, qui rendait alors la session **d'avant** le second facteur. Rien ne levait, et
    // l'écran se re-rendait à l'identique.
    verifyTotp.mockResolvedValue({ outcome: 'completed' })

    let inFlight: ((value: Response) => void) | undefined
    const fetchMock = vi
      .fn()
      // Le rafraîchissement du montage : la session est encore partielle, l'écran reste.
      .mockResolvedValueOnce(Response.json(PARTIAL_OPERATOR))
      // La requête déjà en vol, qui ne répondra qu'après la cérémonie — et avec l'état d'avant.
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            inFlight = resolve
          }),
      )
      // Celle que la cérémonie doit déclencher, et qui porte la vérité.
      .mockImplementation(async () => Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: true }))
    vi.stubGlobal('fetch', fetchMock)

    const client = pendingSession()
    const screen = await renderRoute('/connexion/verification', { queryClient: client })

    await screen.user.click(screen.getByRole('tab', { name: /TOTP/ }))

    // On lance la relecture de fond, puis on la laisse en suspens.
    void client.refetchQueries({ queryKey: OPERATOR_QUERY_KEY, exact: true })
    await screen.user.type(screen.getByLabelText(/Code à 6 chiffres/), '123456')
    await screen.user.click(screen.getByRole('button', { name: /^Vérifier/ }))

    inFlight?.(Response.json(PARTIAL_OPERATOR))

    // La session devient complète : l'écran part. S'il avait rejoint la requête en vol, il serait
    // resté sur le challenge, sans un mot.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Tableau de bord')
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

  it('pose le focus sur le titre même quand il paraît après le squelette', async () => {
    // **Ce que la ref de rappel corrige.** Un effet au montage s'exécutait au premier rendu — qui
    // est ici la frontière de session, un squelette sans titre — et le `<h1>` paraissant ensuite ne
    // recevait jamais le focus. L'opérateur au lecteur d'écran entendait le silence, puis devait
    // re-tabuler à l'aveugle pour découvrir qu'il avait changé d'écran (WCAG 2.4.3).
    let respond: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve
          }),
      ),
    )

    // Aucun cache : le premier rendu est le squelette, et le titre n'existe pas encore.
    const screen = await renderRoute('/connexion/verification', {
      queryClient: createTestQueryClient(),
    })
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()

    respond?.(Response.json(PARTIAL_OPERATOR))

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(document.activeElement).toBe(heading)
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

    // Le stub par défaut de ce fichier rend une session partielle : il faut le remplacer, sinon le
    // rafraîchissement en recrée une et l'écran n'a plus aucune raison de partir.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )

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

    // Un opérateur tout juste amorcé n'a ni appareil ni application : le produit lui doit une sortie,
    // pas un formulaire qui refuse. Depuis la step-028, cette sortie existe — et c'est un lien, pas
    // une phrase qui décrit un recours.
    expect(screen.getByText(/Aucun second facteur enrôlé/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /posez-en un maintenant/ })).toHaveAttribute(
      'href',
      '/connexion/enrolement',
    )
  })
})
