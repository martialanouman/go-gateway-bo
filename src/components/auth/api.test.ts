/**
 * Le client d'authentification, et surtout la **traduction des refus**.
 *
 * Les messages viennent du serveur, verbatim : les réécrire ici en donnerait deux versions, et c'est
 * toujours la version cliente qui finit par en dire trop — « email inconnu » à la place de
 * « identifiant ou mot de passe incorrect ». Ce module ne compose qu'une chose que le serveur ne peut
 * pas composer : **la durée d'attente**, qui arrive dans l'en-tête `retry-after` et non dans le corps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRetryDelay, login, verifyPasskey, verifyTotp } from './api'

// Le navigateur de test n'a pas d'authentificateur : `startAuthentication` est le seul point où le
// produit sort de son propre code, et c'est donc le seul endroit à simuler.
const { startAuthentication } = vi.hoisted(() => ({ startAuthentication: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication }))

/** Une réponse HTTP crédible, en une ligne, pour ne pas noyer l'assertion dans du gréement. */
function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  startAuthentication.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatRetryDelay', () => {
  it('dit les secondes en dessous de la minute', () => {
    expect(formatRetryDelay(45)).toBe('45 secondes')
  })

  it('arrondit au supérieur plutôt qu’à l’inférieur', () => {
    // Annoncer « 1 minute » pour 61 secondes ferait réessayer trop tôt, et le second refus serait
    // mis sur le compte du produit. On promet un peu trop d'attente, jamais trop peu.
    expect(formatRetryDelay(61)).toBe('2 minutes')
  })

  it('accorde le singulier', () => {
    expect(formatRetryDelay(1)).toBe('1 seconde')
    expect(formatRetryDelay(60)).toBe('1 minute')
  })
})

describe('login', () => {
  it('mène au second facteur quand le mot de passe est bon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { mfa_required: true })),
    )

    await expect(login({ identifier: 'a@b.test', password: 'x' })).resolves.toEqual({
      outcome: 'mfa_required',
    })
  })

  it('rend le refus du serveur mot pour mot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(401, { error: 'Connexion refusée : identifiant ou mot de passe incorrect.' }),
      ),
    )

    const result = await login({ identifier: 'a@b.test', password: 'x' })

    // **Mot pour mot** : le serveur a choisi un message qui ne dit pas si le compte existe. Le
    // reformuler ici, même bien intentionné, est la façon la plus simple de rouvrir l'énumération.
    expect(result).toEqual({
      outcome: 'refused',
      message: 'Connexion refusée : identifiant ou mot de passe incorrect.',
    })
  })

  it('ajoute la durée au message de verrouillage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(
          429,
          {
            error:
              'Connexion refusée : trop de tentatives depuis cette adresse. Réessayez plus tard.',
          },
          { 'retry-after': '120' },
        ),
      ),
    )

    const result = await login({ identifier: 'a@b.test', password: 'x' })

    // « Réessayez plus tard » sans échéance fait réessayer immédiatement, donc prolonge le
    // verrouillage. La durée est dans l'en-tête, pas dans le corps : c'est ici qu'elle se raccroche.
    expect(result).toMatchObject({ outcome: 'suspended' })
    expect(result.outcome === 'suspended' && result.message).toContain('2 minutes')
  })

  it('reste lisible quand `retry-after` manque', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(429, { error: 'Connexion refusée : trop de tentatives.' })),
    )

    const result = await login({ identifier: 'a@b.test', password: 'x' })

    // Sans en-tête, on ne fabrique pas une durée : afficher « 0 seconde » serait faux et invitant.
    expect(result).toEqual({
      outcome: 'suspended',
      message: 'Connexion refusée : trop de tentatives.',
    })
  })

  it('n’envoie que du JSON', async () => {
    const fetchMock = vi.fn(async () => respond(200, { mfa_required: true }))
    vi.stubGlobal('fetch', fetchMock)

    await login({ identifier: 'a@b.test', password: 'x' })

    // Le handler refuse tout ce qui n'est pas `application/json`, et pour une raison de fond : un
    // formulaire `urlencoded` est une *simple request*, donc sans preflight CORS — n'importe quelle
    // page visitée pourrait déclencher des tentatives depuis le navigateur de l'opérateur.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('rend un refus lisible quand le réseau tombe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const result = await login({ identifier: 'a@b.test', password: 'x' })

    // Une promesse rejetée remonterait en surface non gérée et laisserait le formulaire figé sur
    // « Connexion en cours ». L'opérateur doit savoir que ce n'est pas son mot de passe.
    expect(result.outcome).toBe('unreachable')
  })
})

describe('verifyTotp', () => {
  it('accepte le code et signale la session complète', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { mfa_completed: true })),
    )

    await expect(verifyTotp('123456')).resolves.toEqual({ outcome: 'completed' })
  })

  it('rend le refus du serveur mot pour mot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(401, { error: 'Vérification refusée : code incorrect ou expiré.' }),
      ),
    )

    await expect(verifyTotp('000000')).resolves.toEqual({
      outcome: 'refused',
      message: 'Vérification refusée : code incorrect ou expiré.',
    })
  })

  it('ajoute la durée à la suspension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(
          429,
          { error: 'Vérification suspendue : trop de tentatives.' },
          { 'retry-after': '30' },
        ),
      ),
    )

    const result = await verifyTotp('000000')

    expect(result.outcome === 'suspended' && result.message).toContain('30 secondes')
  })
})

/**
 * La cérémonie passkey tient en deux allers-retours encadrant un appel au navigateur. Les tests
 * simulent `@simplewebauthn/browser` : ce qui est vérifié ici est **l'enchaînement et la traduction
 * des refus**, pas la cryptographie — celle-ci est prouvée côté serveur par un authentificateur
 * logiciel aux signatures réelles, et dans un vrai navigateur par `e2e/passkey.spec.ts`.
 */
describe('verifyPasskey', () => {
  it('enchaîne options, signature, vérification', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { options: { challenge: 'abc' } }))
      .mockResolvedValueOnce(respond(200, { mfa_completed: true }))
    vi.stubGlobal('fetch', fetchMock)
    startAuthentication.mockResolvedValueOnce({ id: 'cred-1' })

    await expect(verifyPasskey()).resolves.toEqual({ outcome: 'completed' })

    // Les options du serveur sont passées telles quelles : les recopier champ à champ ferait
    // silencieusement disparaître le jour où le serveur en ajoute un.
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } })

    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ response: { id: 'cred-1' } })
  })

  it('distingue « aucun appareil enregistré » d’un refus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409, { error: 'Aucun appareil enregistré sur ce compte.' })),
    )

    const result = await verifyPasskey()

    // **Le cas qui décide de l'écran.** Un refus dit « réessayez » ; celui-ci dit « prenez l'autre
    // facteur ». Les confondre laisserait un opérateur cliquer indéfiniment sur un bouton qui ne
    // peut pas aboutir.
    expect(result.outcome).toBe('no_passkey')
  })

  it('traite l’abandon de l’opérateur comme un abandon, pas comme un échec', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { options: {} })),
    )
    startAuthentication.mockRejectedValueOnce(
      Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      }),
    )

    const result = await verifyPasskey()

    // Fermer la fenêtre système n'est pas une erreur. Peindre une alerte rouge apprendrait à
    // l'opérateur à ignorer les alertes rouges.
    expect(result.outcome).toBe('cancelled')
  })
})
