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
    login.mockResolvedValue({ outcome: 'mfa_required' })

    // Le cache amorcé tient lieu de ce que `/auth/me` répondrait une fois le mot de passe accepté :
    // une session **partielle**, qui sait qui s'authentifie et ne porte aucune permission. Sans
    // elle, l'écran d'arrivée n'aurait rien à compléter et renverrait aussitôt ici.
    const client = createTestQueryClient()
    client.setQueryData(OPERATOR_QUERY_KEY, {
      id: 'op-1',
      email: 'operatrice@example.test',
      displayName: 'Opératrice',
      permissions: [],
      mfaCompleted: false,
    })

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

    // Ni dans l'URL, ni dans un message, ni dans un attribut de trace. Le champ est de type
    // `password` et sa valeur ne se lit pas dans le texte rendu.
    expect(document.body.textContent).not.toContain('un-secret-a-ne-pas-repeindre')
    expect(window.location.href).not.toContain('un-secret-a-ne-pas-repeindre')
  })
})
