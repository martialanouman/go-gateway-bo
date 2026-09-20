import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetChallenge, peekChallenge } from '~/lib/session'
import { createAppRouter } from '~/router'
import { type AuthReplies, CHALLENGE, stubSession } from '../../test/session'

beforeEach(forgetChallenge)
afterEach(forgetChallenge)

/**
 * L'écran de connexion tel que l'application le monte : vrai routeur, vrai `QueryClient`, vrai
 * client HTTP. Seul `fetch` est remplacé — rien du produit n'est injecté.
 */
async function visitLogin(path = '/login', replies: AuthReplies = {}) {
  stubSession({ status: 401 }, replies)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))

  render(<RouterProvider router={router} />)
  // Le formulaire, et non le titre : l'écran d'attente de la garde porte le **même** titre, si bien
  // qu'attendre un `h1` rendait la main avant que le formulaire n'existe.
  await screen.findByLabelText(/E-mail/)

  return { router, user: userEvent.setup() }
}

const email = () => screen.getByLabelText(/E-mail/)
const password = () => screen.getByLabelText(/Mot de passe/)
const submit = () => screen.getByRole('button', { name: 'Se connecter' })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(email(), 'a.kouadio@example.test')
  await user.type(password(), 'un-mot-de-passe')
  await user.click(submit())
}

describe("l'écran de connexion", () => {
  it('énonce ce qu’il demande, sans rail ni barre supérieure', async () => {
    await visitLogin()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connexion')
    // Hors de la coquille : aucune entrée de navigation ne mènerait ailleurs qu'à un refus.
    expect(screen.queryByRole('navigation', { name: 'Navigation principale' })).toBeNull()
    expect(email()).toBeRequired()
    expect(password()).toHaveAttribute('type', 'password')
    // La marque porte l'optionnel, jamais l'obligatoire : aucun de ces deux libellés ne l'annonce.
    expect(screen.queryByText('(optionnel)')).toBeNull()
  })

  it('mène au second facteur et retient le challenge hors de l’URL', async () => {
    const { router, user } = await visitLogin('/login?redirect=%2Fbilling')

    await fillAndSubmit(user)

    // Attendu **par son nom** : juste après l'envoi, l'écran de connexion est encore monté,
    // et un `findByRole('heading')` sans nom rend son titre à lui.
    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
    // La destination demandée traverse le second facteur : c'est elle qu'on rejouera.
    expect(router.state.location.search).toEqual({ redirect: '/billing' })

    expect(peekChallenge()).toBe(CHALLENGE)
    expect(router.state.location.searchStr).not.toContain(CHALLENGE)
    expect(document.body.innerHTML).not.toContain(CHALLENGE)
  })
})

describe('les refus du premier facteur', () => {
  it('rend le refus du serveur mot pour mot, sans dire lequel des deux a manqué', async () => {
    const { user } = await visitLogin('/login', {
      login: {
        status: 401,
        body: {
          code: 'invalid_credentials',
          message:
            "La connexion a été refusée : l'adresse ou le mot de passe ne correspond pas. Réessayez.",
        },
      },
    })

    await fillAndSubmit(user)

    const refus = await screen.findByRole('alert')
    expect(refus).toHaveTextContent(
      "La connexion a été refusée : l'adresse ou le mot de passe ne correspond pas.",
    )
    // Le miroir bavard d'une garde qui se tait : l'écran ne doit pas nommer ce que le serveur
    // refuse de nommer (step-021).
    expect(refus).not.toHaveTextContent(/adresse inconnue|compte désactivé|mot de passe faux/i)
  })

  it('annonce la durée du verrouillage, qu’un refus muet ferait retenter', async () => {
    const { user } = await visitLogin('/login', {
      login: {
        status: 429,
        headers: { 'Retry-After': '240' },
        body: {
          code: 'too_many_attempts',
          message:
            'La connexion est temporairement bloquée après plusieurs échecs : réessayez dans 4 minutes.',
        },
      },
    })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('réessayez dans 4 minutes')
  })

  it('dit la panne et garde la saisie, plutôt que de vider l’écran', async () => {
    const { user } = await visitLogin('/login', {
      login: { status: 503, body: { code: 'overloaded', message: 'Le serveur vérifie déjà…' } },
    })

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Le serveur vérifie déjà…')
    // Invariant (e) : la panne dégrade. Retaper une adresse après un 503 est ce qui fait fermer
    // l'onglet.
    expect(email()).toHaveValue('a.kouadio@example.test')
  })
})

describe('les erreurs champ par champ', () => {
  it('nomme le champ qui manque, et le relie à son message', async () => {
    const { user } = await visitLogin()

    await user.click(submit())

    const champ = email().closest('.ui-field')
    expect(email()).toHaveAttribute('aria-invalid', 'true')
    expect(within(champ as HTMLElement).getByRole('alert')).toHaveTextContent('Saisissez un e-mail')
    // Le mot de passe manque aussi : les deux refus s'affichent, et non le premier seulement.
    expect(password()).toHaveAttribute('aria-invalid', 'true')
  })

  it('n’envoie rien au BFF tant qu’un champ manque', async () => {
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(email(), 'a.kouadio@example.test')
    await user.click(submit())

    const posts = fetch.mock.calls.filter(([request]) => request.method === 'POST')
    expect(posts).toEqual([])
  })

  it('efface le refus d’un champ dès qu’il est corrigé', async () => {
    const { user } = await visitLogin()

    await user.click(submit())
    expect(email()).toHaveAttribute('aria-invalid', 'true')

    await user.type(email(), 'a.kouadio@example.test')

    // Un refus qui survit à sa correction fait douter de tous les autres.
    expect(email()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('le clavier', () => {
  it('traverse le formulaire dans l’ordre lu et se valide sans souris', async () => {
    const { router, user } = await visitLogin()

    // L'écran n'a qu'une tâche, et le premier champ la porte : l'opérateur tape sans chercher.
    expect(email()).toHaveFocus()
    await user.type(email(), 'a.kouadio@example.test')

    await user.tab()
    expect(password()).toHaveFocus()
    await user.type(password(), 'un-mot-de-passe{Enter}')

    // Attendu **par son nom** : juste après l'envoi, l'écran de connexion est encore monté,
    // et un `findByRole('heading')` sans nom rend son titre à lui.
    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })
})

describe('ce que le client croit savoir de la session', () => {
  it('relit /auth/me après la connexion, plutôt que de servir la copie d’avant', async () => {
    // Une session **ouverte et non élevée** : le formulaire reste servi — se reconnecter est la
    // seule remédiation d'un cookie qu'on croit compromis —, et surtout `/auth/me` a déjà répondu,
    // donc sa réponse est en cache et fraîche pour une minute.
    stubSession({ permissions: [], elevated: false })
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/login'] }))
    render(<RouterProvider router={router} />)
    await screen.findByLabelText(/E-mail/)

    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }
    const lectures = () =>
      fetch.mock.calls.filter(([request]) => request.url.endsWith('/api/auth/me')).length
    const avant = lectures()

    await fillAndSubmit(userEvent.setup())
    await screen.findByRole('heading', { level: 1, name: /Second facteur/ })

    // Sans l'oubli, la garde du second facteur lirait la session **d'avant la connexion**, encore
    // fraîche : c'est ainsi qu'un `elevated` périmé renverrait en boucle sur cet écran.
    expect(lectures()).toBeGreaterThan(avant)
  })
})

describe('une session déjà élevée', () => {
  it('ne reste pas sur le formulaire : elle rejoint la destination demandée', async () => {
    // Sans ce renvoi, un retour en arrière après la connexion déposerait l'opérateur sur un
    // formulaire qu'il vient de franchir — un cul-de-sac dont la seule sortie est l'URL.
    stubSession({ permissions: [] })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/login?redirect=%2Fbilling'] }),
    )
    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Soldes & crédits/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/billing')
  })
})

describe('la réduction de la destination, à son point d’appel', () => {
  it('ne suit pas une URL de schéma relatif collée dans le paramètre', async () => {
    // `session.test.ts` tient `safeDestination` en tant que **fonction**. Ce test-ci tient son
    // **câblage** : la fonction gardée et la route non câblée passaient les mêmes assertions —
    // c'est la mesure sur un proxy. Ici la route est visitée pour de bon, avec une session élevée,
    // donc le renvoi s'exécute.
    stubSession({ permissions: [] })
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/login?redirect=%2F%2Failleurs.example'] }),
    )
    render(<RouterProvider router={router} />)

    await screen.findByRole('heading', { level: 1, name: /cockpit d’exploitation|cockpit/i })
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.href).not.toContain('ailleurs.example')
  })
})

describe('l’attente de la garde', () => {
  it('peint un squelette du formulaire, et non un blanc', async () => {
    // La garde s'exécute **avant** tout rendu : sans `pendingComponent`, l'écran reste vide le
    // temps d'un aller-retour, juste après le squelette peint par `index.html`. Les deux helpers
    // de ce fichier décrivent cet écran en commentaire et le contournaient sans jamais l'affirmer.
    stubSession('pending')
    render(
      <RouterProvider
        router={createAppRouter(createMemoryHistory({ initialEntries: ['/login'] }))}
      />,
    )

    // **Une fenêtre courte, et c'est tout l'objet de ce test.** La fenêtre par défaut de `findBy`
    // vaut 1000 ms — exactement le délai que TanStack applique quand `defaultPendingMs: 0` n'est
    // pas posé. Un `findBy` nu rendrait donc vert avec ou sans ce réglage, et ne mesurerait que
    // lui-même. Mesuré : à 200 ms ce test rougit dès que la ligne disparaît du routeur.
    expect(
      await screen.findByText('Vérification de la session en cours', undefined, { timeout: 200 }),
    ).toBeInTheDocument()
    expect(document.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connexion')
  })
})

describe('le refus serveur et ce qu’il décrit', () => {
  it('disparaît quand la validation cliente prend la main', async () => {
    // Le refus porte sur des identifiants **envoyés**. Dès qu'un champ manque, l'envoi n'a pas
    // lieu : le message décrirait alors une requête qui ne correspond plus à ce qui est à l'écran,
    // et l'opérateur lirait deux diagnostics contradictoires en même temps. Ce qui l'efface est la
    // frappe qui vide le champ, pas l'envoi — vérifié en retirant chacun des deux.
    const { user } = await visitLogin('/login', {
      login: {
        status: 401,
        body: { code: 'invalid_credentials', message: 'La connexion a été refusée : …' },
      },
    })

    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('La connexion a été refusée')

    await user.clear(email())
    await user.click(submit())

    expect(screen.queryByText(/La connexion a été refusée/)).toBeNull()
    expect(email()).toHaveAttribute('aria-invalid', 'true')
  })

  it('disparaît dès que les identifiants qu’il refusait sont corrigés', async () => {
    const { user } = await visitLogin('/login', {
      login: {
        status: 401,
        body: { code: 'invalid_credentials', message: 'La connexion a été refusée : …' },
      },
    })

    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('La connexion a été refusée')

    await user.type(email(), 'x')

    // Un refus qui survit à ce qu'il reproche fait douter de tous les autres — la règle déjà
    // appliquée champ par champ vaut pour le refus qui les surplombe.
    expect(screen.queryByText(/La connexion a été refusée/)).toBeNull()
  })
})

describe('le format de l’e-mail', () => {
  it('nomme ce qui manque et montre un exemple, sans partir au serveur', async () => {
    // Sans ce contrôle, `admin@` part au BFF, y coûte un argon2id, et revient en 401 générique :
    // l'opérateur croit s'être trompé de mot de passe. Le format ne dit **rien** de l'existence du
    // compte — il ne rouvre donc pas l'oracle d'énumération que le serveur ferme.
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(email(), 'admin@')
    await user.type(password(), 'un-mot-de-passe')
    await user.click(submit())

    expect(email()).toHaveAttribute('aria-invalid', 'true')
    expect(
      within(email().closest('.ui-field') as HTMLElement).getByRole('alert'),
    ).toHaveTextContent('ops@exemple.ci')
    expect(fetch.mock.calls.filter(([r]) => r.method === 'POST')).toEqual([])
  })

  it('laisse passer une adresse complète', async () => {
    const { router, user } = await visitLogin()

    await user.type(email(), 'a.kouadio@example.test')
    await user.type(password(), 'un-mot-de-passe')
    await user.click(submit())

    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })
})

describe('les bornes du contrat, à l’écran', () => {
  it('refuse un mot de passe plus long que ce que le serveur accepte, sans partir au BFF', async () => {
    // La borne est celle du contrat — `password.maxLength: 4096` — et elle n'est écrite ni dans cet
    // écran ni dans ce test : elle arrive par `LoginRequest`, qu'engendre `cmd/zodgen`. Sans elle,
    // ce corps part au BFF, qui le refuse en 400 après l'avoir lu en entier.
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(email(), 'a.kouadio@example.test')
    // `paste` et non `type` : quatre mille frappes simulées prennent des minutes, et personne ne
    // tape un mot de passe de cette longueur — il est collé d'un gestionnaire.
    await user.click(password())
    await user.paste('x'.repeat(4097))
    await user.click(submit())

    const refusal = within(password().closest('.ui-field') as HTMLElement).getByRole('alert')
    expect(refusal).toHaveTextContent('4096')
    // La phrase **française**, et pas seulement le nombre : « Too big: expected string to have
    // <=4096 characters » porte le même 4096. Sans cette seconde assertion, `formResolver` qui
    // oublierait de passer sa rédaction laissait la suite verte et l'écran en anglais.
    expect(refusal).toHaveTextContent(/trop longue/)
    expect(fetch.mock.calls.filter(([r]) => r.method === 'POST')).toEqual([])
  })

  it('laisse passer ce qui tient exactement dans la borne', async () => {
    const { router, user } = await visitLogin()

    await user.type(email(), 'a.kouadio@example.test')
    await user.click(password())
    await user.paste('x'.repeat(4096))
    await user.click(submit())

    expect(
      await screen.findByRole('heading', { level: 1, name: /Second facteur/ }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/mfa')
  })
})

describe('les quatre couches du formulaire', () => {
  it('ne rend qu’un message par champ refusé, et non celui de chacune', async () => {
    // React Hook Form tient l'état, Zod la forme, Base UI le rendu. Brancher en plus le moteur de
    // validité de Base UI — `required` est posé, donc `valueMissing` est vrai — ferait deux messages
    // dans le même champ, dont un en anglais et hors de la charte.
    const { user } = await visitLogin()

    await user.click(submit())

    expect(within(email().closest('.ui-field') as HTMLElement).getAllByRole('alert')).toHaveLength(
      1,
    )
    expect(
      within(password().closest('.ui-field') as HTMLElement).getAllByRole('alert'),
    ).toHaveLength(1)
  })
})

describe('ce que le formulaire envoie vraiment', () => {
  it('poste l’adresse débarrassée des espaces qui l’entourent', async () => {
    // Le décor tient l'état du serveur mais n'avait jamais lu un **corps** de requête : le contrôle
    // de format travaillait sur une adresse rognée quand l'envoi, lui, partait telle quelle. Une
    // adresse collée depuis un gestionnaire de mots de passe traîne régulièrement une espace.
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.type(email(), '  a.kouadio@example.test  ')
    await user.type(password(), 'un-mot-de-passe')
    await user.click(submit())

    const posted = fetch.mock.calls
      .map(([request]) => request)
      .find((request) => request.url.endsWith('/api/auth/login'))
    expect(await posted?.clone().json()).toEqual({
      email: 'a.kouadio@example.test',
      password: 'un-mot-de-passe',
    })
  })
})

describe('la borne de l’adresse, que rien ne tenait', () => {
  it('refuse une adresse plus longue que ce que le serveur accepte, sans partir au BFF', async () => {
    // `email.maxLength: 320`, la borne symétrique de celle du mot de passe. Elle n'atteignait
    // l'écran que par un `.pipe` qu'aucune porte ne tenait : retiré, une adresse de 323 caractères
    // partait au BFF sans un mot. Le but même de la step était donc gardé pour un champ sur deux.
    const { user } = await visitLogin()
    const fetch = globalThis.fetch as unknown as { mock: { calls: [Request][] } }

    await user.click(email())
    await user.paste(`${'a'.repeat(310)}@exemple.test`)
    await user.type(password(), 'un-mot-de-passe')
    await user.click(submit())

    const refusal = within(email().closest('.ui-field') as HTMLElement).getByRole('alert')
    expect(refusal).toHaveTextContent('320')
    expect(refusal).toHaveTextContent(/trop longue/)
    expect(fetch.mock.calls.filter(([r]) => r.method === 'POST')).toEqual([])
  })
})

describe('le refus du mot de passe vide, et sa rédaction', () => {
  it('nomme le champ plutôt que de citer la borne du contrat', async () => {
    // L'ordre du `.pipe` est ce qui décide : les règles de l'écran **puis** celles du contrat. Le
    // contrat pose `minLength: 1` sur le mot de passe, et l'ordre inverse ferait lire « Cette saisie
    // est trop courte : 1 caractère au minimum. » — vrai, générique, et muet sur le champ.
    const { user } = await visitLogin()

    await user.click(submit())

    expect(
      within(password().closest('.ui-field') as HTMLElement).getByRole('alert'),
    ).toHaveTextContent('Saisissez un mot de passe')
  })
})
