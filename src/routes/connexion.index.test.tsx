/**
 * L'écran de connexion — la porte d'entrée du produit.
 *
 * Trois choses s'y jouent, et aucune n'est cosmétique :
 *
 * 1. **Aucune énumération.** Le message de refus est celui du serveur, mot pour mot, et il ne dit
 *    jamais si le compte existe. Un écran qui distingue « email inconnu » de « mot de passe
 *    incorrect » offre un annuaire d'opérateurs à qui sonde la console.
 * 2. **Le verrouillage dit son échéance.** « Réessayez plus tard » fait réessayer tout de suite.
 * 3. **L'erreur est annoncée**, pas seulement affichée : un opérateur au lecteur d'écran doit savoir
 *    que sa tentative a échoué sans avoir à reparcourir le formulaire.
 */

import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { createTestQueryClient } from '~/test/render'
import { renderRoute } from '~/test/render-route'

const { login } = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('~/components/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/components/auth/api')>()),
  login,
}))

beforeEach(() => {
  login.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Ce que `/auth/me` répond juste après un mot de passe accepté. */
const PARTIAL_OPERATOR = {
  id: 'op-1',
  email: 'operatrice@example.test',
  displayName: 'Opératrice',
  permissions: [],
  mfaCompleted: false,
} as const

/** Remplit et soumet, comme un opérateur : par le clavier et par les libellés, jamais par un id. */
async function submitCredentials(
  screen: Awaited<ReturnType<typeof renderRoute>>,
  identifier = 'operatrice@example.test',
  password = 'un-mot-de-passe',
) {
  await screen.user.type(screen.getByLabelText(/Adresse e-mail/), identifier)
  await screen.user.type(screen.getByLabelText(/Mot de passe/), password)
  await screen.user.click(screen.getByRole('button', { name: /Continuer/ }))
}

describe('l’écran de connexion', () => {
  it('rend un formulaire nommé et atteignable au clavier', async () => {
    const screen = await renderRoute('/connexion')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connexion opérateur')
    expect(screen.getByLabelText(/Adresse e-mail/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Mot de passe/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continuer/ })).toBeInTheDocument()
  })

  it('n’est pas sous la coquille', async () => {
    // Le login est public : le rendre sous une barre qui affiche le nom de l'opérateur connecté
    // serait faux, et le rail de navigation n'aurait aucune entrée à montrer.
    const screen = await renderRoute('/connexion')

    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
  })

  it('mène au second facteur quand le mot de passe passe', async () => {
    // On part de l'état réel : **aucune session**. Amorcer le cache avec une session partielle
    // renverrait immédiatement au second facteur sans laisser taper quoi que ce soit — c'est
    // précisément la garde en sens inverse que cet écran porte désormais.
    const client = createTestQueryClient()
    client.setQueryData(OPERATOR_QUERY_KEY, null)

    // Et `/auth/me` **change de réponse** au moment du login, comme le vrai : 401 avant, session
    // partielle après. Un stub constant faisait basculer l'écran dès le montage, puisque le client
    // de test tient tout pour périmé et rafraîchit aussitôt — le formulaire disparaissait avant que
    // le mot de passe soit tapé.
    let authenticated = false
    login.mockImplementation(async () => {
      authenticated = true
      return { outcome: 'mfa_required' }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        authenticated ? Response.json(PARTIAL_OPERATOR) : new Response(null, { status: 401 }),
      ),
    )

    const screen = await renderRoute('/connexion', { queryClient: client })

    await submitCredentials(screen)

    expect(login).toHaveBeenCalledWith({
      identifier: 'operatrice@example.test',
      password: 'un-mot-de-passe',
    })
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Vérification en deux étapes',
    )
  })

  it('n’offre pas de se reconnecter à qui est déjà connecté', async () => {
    // Un opérateur qui ouvre son signet `/connexion` recevait le formulaire, ressaisissait son mot
    // de passe et ouvrait une seconde session pour rien — en consommant une tentative du compteur
    // anti-brute-force si sa saisie ratait.
    const client = createTestQueryClient()
    client.setQueryData(OPERATOR_QUERY_KEY, { ...PARTIAL_OPERATOR, mfaCompleted: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ...PARTIAL_OPERATOR, mfaCompleted: true })),
    )

    const screen = await renderRoute('/connexion', { queryClient: client })

    await vi.waitFor(() => {
      expect(screen.queryByLabelText(/Mot de passe/)).toBeNull()
    })
  })

  it('relit la session avant de partir au second facteur', async () => {
    // **Le cas réel, et il n'est pas théorique.** L'opérateur arrive ici parce que la garde de la
    // coquille a lu `null` sur `/auth/me` et l'a écrit dans le cache. Si le login part sans
    // invalider cette clé, l'écran de vérification lit le même `null`, se croit sans session, et
    // renvoie au login : une boucle que seul un parcours complet fait apparaître.
    login.mockResolvedValue({ outcome: 'mfa_required' })

    // **Le client reproduit la fraîcheur de production**, et c'est le cœur de ce test. Avec le
    // `staleTime` de zéro du harnais, `fetchQuery` interroge toujours le serveur et le test passerait
    // sans rien garder ; avec celui du produit, il rendrait le `null` qu'il tient pour frais — à
    // moins que l'écran ne demande explicitement une relecture.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    client.setQueryData(OPERATOR_QUERY_KEY, null)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(PARTIAL_OPERATOR)),
    )

    const screen = await renderRoute('/connexion', { queryClient: client })
    await submitCredentials(screen)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Vérification en deux étapes',
    )
  })

  it('n’appelle pas une panne du serveur un refus', async () => {
    // Une panne et un mot de passe faux sont deux des cinq états de contenu, et les peindre à
    // l'identique fait conclure à un identifiant devenu invalide pendant une indisponibilité du BFF.
    // L'opérateur essaie des variantes, puis appelle le support pour une réinitialisation dont il
    // n'a pas besoin.
    login.mockResolvedValue({ outcome: 'unreachable', message: 'Le serveur n’a pas répondu.' })
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen)

    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/refus/i)
    expect(alert).toHaveTextContent(/n’a pas répondu/)

    // Pas de bouton « Réessayer » séparé : le formulaire **est** la reprise, et il reste utilisable.
    // En ajouter un deuxième laisserait l'opérateur choisir entre deux façons de faire la même
    // chose, dont une seule renvoie ses identifiants.
    expect(screen.getByRole('button', { name: /Continuer/ })).toBeInTheDocument()
  })

  it('part quand même au second facteur si la relecture de session échoue', async () => {
    // Le mot de passe est accepté : c'est acquis, et un `/auth/me` qui tombe juste après ne doit pas
    // retenir l'opérateur sur un formulaire qu'il vient de remplir avec succès. L'écran suivant
    // portera lui-même l'état de panne.
    const client = createTestQueryClient()
    client.setQueryData(OPERATOR_QUERY_KEY, null)

    let authenticated = false
    login.mockImplementation(async () => {
      authenticated = true
      return { outcome: 'mfa_required' }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        authenticated ? new Response('nope', { status: 502 }) : new Response(null, { status: 401 }),
      ),
    )

    const screen = await renderRoute('/connexion', { queryClient: client })
    await submitCredentials(screen)

    // Ni exception non gérée, ni formulaire figé sur « Connexion en cours ».
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /Connexion en cours/ })).toBeNull()
    })
  })

  it('affiche le refus du serveur sans rien y ajouter', async () => {
    login.mockResolvedValue({
      outcome: 'refused',
      message: 'Connexion refusée : identifiant ou mot de passe incorrect.',
    })
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Connexion refusée : identifiant ou mot de passe incorrect.')

    // **Aucune énumération** : ni le mot « email », ni le mot « compte », ni « inconnu ». L'écran ne
    // doit pas pouvoir dire ce que le serveur a refusé de dire.
    expect(alert.textContent).not.toMatch(/inconnu|introuvable|n’existe pas/i)
  })

  it('dit l’échéance du verrouillage', async () => {
    login.mockResolvedValue({
      outcome: 'suspended',
      message: 'Connexion refusée : trop de tentatives. Réessayez dans 2 minutes.',
    })
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen)

    expect(await screen.findByRole('alert')).toHaveTextContent('Réessayez dans 2 minutes.')
  })

  it('annonce l’échec sans faire reparcourir le formulaire', async () => {
    login.mockResolvedValue({ outcome: 'refused', message: 'Connexion refusée.' })
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen)

    // `role="alert"` porte `aria-live="assertive"` : le lecteur d'écran interrompt et lit le refus.
    // Sans lui, l'opérateur ne saurait qu'il a échoué qu'en revenant sur le champ.
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
  })

  it('ne laisse pas soumettre deux fois pendant l’attente', async () => {
    // Un double clic ouvrirait deux sessions, et le second compteur d'échecs punirait l'opérateur
    // pour un geste que l'interface a laissé passer.
    let release: (value: unknown) => void = () => {}
    login.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen)

    expect(screen.getByRole('button', { name: /Connexion en cours/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    // La soumission au clavier est couverte elle aussi : une touche Entrée dans un champ déclenche
    // une soumission implicite, qui passe par le bouton — donc par le `preventDefault` de `loading`.
    // C'est ce que cette ligne établit ; retirer la garde du gestionnaire ne fait pas rougir ce
    // test, et c'est écrit dans `connexion.index.tsx` plutôt que laissé à deviner.
    await screen.user.type(screen.getByLabelText(/Mot de passe/), '{Enter}')

    release({ outcome: 'refused', message: 'Connexion refusée.' })
    await screen.findByRole('alert')
    expect(login).toHaveBeenCalledTimes(1)
  })

  it('n’écrit jamais le mot de passe ailleurs que dans son champ', async () => {
    login.mockResolvedValue({ outcome: 'refused', message: 'Connexion refusée.' })
    const screen = await renderRoute('/connexion')

    await submitCredentials(screen, 'operatrice@example.test', 'un-secret-a-ne-pas-repeindre')
    await screen.findByRole('alert')

    // **Le document privé de son champ de mot de passe**, et non `textContent`. La valeur d'un
    // `<input>` est une propriété que `textContent` ne rend jamais : l'assertion précédente passait
    // donc même si le mot de passe avait été recopié dans un attribut `value` ou `data-*` ailleurs.
    // React reflète bien la valeur en attribut — c'est visible dans le sérialisé — d'où le retrait
    // du champ légitime avant de regarder tout le reste.
    const elsewhere = document.body.cloneNode(true) as HTMLElement
    for (const field of elsewhere.querySelectorAll('input[type="password"]')) field.remove()

    expect(elsewhere.innerHTML).not.toContain('un-secret-a-ne-pas-repeindre')
    expect(window.location.href).not.toContain('un-secret-a-ne-pas-repeindre')

    // Et le champ reste masqué : `type="password"` est ce qui empêche l'épaule voisine de lire.
    expect(screen.getByLabelText(/Mot de passe/)).toHaveAttribute('type', 'password')
  })
})
