// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayError } from './errors'
import { createTokenProvider } from './token'

describe('createTokenProvider', () => {
  let now = 0
  const advance = (ms: number) => {
    now += ms
  }

  beforeEach(() => {
    now = 1_700_000_000_000
  })

  it('demande un jeton une seule fois tant que le précédent est valide', async () => {
    const fetch = tokenEndpoint({ access_token: 'jeton-1', expires_in: 3600 })
    const provider = createTokenProvider(options(fetch, () => now))

    await expect(provider.getAccessToken()).resolves.toBe('jeton-1')
    advance(60_000)
    await expect(provider.getAccessToken()).resolves.toBe('jeton-1')

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('renouvelle AVANT expiration, pas après', async () => {
    // Renouveler à l'expiration exacte, c'est garantir qu'une requête en vol part avec un jeton
    // périmé : l'horloge de la passerelle n'est pas la nôtre. La marge est prise à l'avance.
    const fetch = tokenEndpoint(
      { access_token: 'jeton-1', expires_in: 3600 },
      { access_token: 'jeton-2', expires_in: 3600 },
    )
    const provider = createTokenProvider(options(fetch, () => now, { refreshSkewMs: 60_000 }))

    await provider.getAccessToken()

    // 3 540 s : encore valide au sens strict, mais dans la fenêtre de renouvellement.
    advance(3_540_000)
    await expect(provider.getAccessToken()).resolves.toBe('jeton-2')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("ne lance qu'une seule requête quand plusieurs appels arrivent sur un cache froid", async () => {
    // Au démarrage d'une instance, les premières requêtes d'écran partent ensemble. Sans
    // dédoublonnage, chacune ouvrirait sa propre demande de jeton — une rafale sur l'Admin API à
    // chaque déploiement (invariant e).
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetch = vi.fn(async () => {
      await gate
      return tokenResponse({ access_token: 'jeton-1', expires_in: 3600 })
    })
    const provider = createTokenProvider(options(fetch, () => now))

    const calls = Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
      provider.getAccessToken(),
    ])
    release?.()

    expect(await calls).toEqual(['jeton-1', 'jeton-1', 'jeton-1', 'jeton-1', 'jeton-1'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('ne met pas un échec en cache : la demande suivante retente', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'invalid_client', message: 'Refusé.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(tokenResponse({ access_token: 'jeton-1', expires_in: 3600 }))
    const provider = createTokenProvider(options(fetch, () => now))

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(GatewayError)
    await expect(provider.getAccessToken()).resolves.toBe('jeton-1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("distingue « le BFF ne sait pas s'authentifier » d'une panne réseau ordinaire", async () => {
    // Les deux situations n'appellent ni la même copie ni la même réaction : l'une est une panne de
    // configuration du tableau de bord, l'autre un incident de la passerelle.
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const provider = createTokenProvider(options(fetch, () => now))

    const error = await provider.getAccessToken().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).code).toBe('gateway_authentication_failed')
  })

  describe('durée de vie annoncée par le serveur', () => {
    // Chacun de ces cas produisait, avant correction, une expiration immédiate — donc une demande
    // de jeton AVANT CHAQUE appel Admin, indéfiniment et sans plafond. C'est l'invariant (e) qui
    // tombe : le tableau de bord doublerait le trafic vers la passerelle qu'il est censé observer.
    const cases: { nom: string; expires_in: unknown }[] = [
      { nom: 'absente (OPTIONAL au sens de la RFC 6749)', expires_in: undefined },
      { nom: 'textuelle, comme la renvoient plusieurs serveurs OAuth', expires_in: '3600' },
      { nom: 'non numérique', expires_in: 'bientôt' },
      { nom: 'négative', expires_in: -1 },
      { nom: 'nulle', expires_in: 0 },
    ]

    for (const { nom, expires_in } of cases) {
      it(`met le jeton en cache quand la durée est ${nom}`, async () => {
        const fetch = vi.fn(async () => tokenResponse({ access_token: 'jeton-1', expires_in }))
        const provider = createTokenProvider(options(fetch, () => now))

        await provider.getAccessToken()
        advance(1000)
        await provider.getAccessToken()

        expect(fetch).toHaveBeenCalledTimes(1)
      })
    }

    it('réduit la marge plutôt que de rallonger un jeton court', async () => {
      // Jeton de 60 s, marge demandée de 60 s : appliquer la marge telle quelle rendrait le cache
      // inutile. La marge se réduit à la moitié de la durée de vie — jamais l'inverse, qui
      // reviendrait à présenter un jeton après son expiration.
      const fetch = vi.fn(async () => tokenResponse({ access_token: 'jeton-1', expires_in: 60 }))
      const provider = createTokenProvider(options(fetch, () => now, { refreshSkewMs: 60_000 }))

      await provider.getAccessToken()
      advance(20_000)
      await provider.getAccessToken()
      expect(fetch).toHaveBeenCalledTimes(1)

      // Au-delà de 30 s (60 s − la moitié), le renouvellement doit partir.
      advance(11_000)
      await provider.getAccessToken()
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('invalidation', () => {
    it('jette le jeton présenté et en redemande un', async () => {
      // Sans cela, une passerelle qui révoque un jeton avant son expiration annoncée (redémarrage
      // du serveur OAuth, rotation de clé) fige le tableau de bord sur des 401 jusqu'au prochain
      // redémarrage du processus.
      const fetch = tokenEndpoint(
        { access_token: 'jeton-1', expires_in: 3600 },
        { access_token: 'jeton-2', expires_in: 3600 },
      )
      const provider = createTokenProvider(options(fetch, () => now))

      await expect(provider.getAccessToken()).resolves.toBe('jeton-1')
      provider.invalidate('jeton-1')

      await expect(provider.getAccessToken()).resolves.toBe('jeton-2')
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('ignore la demande portant sur un jeton déjà remplacé', async () => {
      // Deux requêtes reçoivent un 401 avec l'ancien jeton ; la première le renouvelle. Si la
      // seconde jetait le jeton tout neuf, les renouvellements s'enchaîneraient en cascade.
      const fetch = tokenEndpoint(
        { access_token: 'jeton-1', expires_in: 3600 },
        { access_token: 'jeton-2', expires_in: 3600 },
      )
      const provider = createTokenProvider(options(fetch, () => now))

      await provider.getAccessToken()
      provider.invalidate('jeton-1')
      await provider.getAccessToken()

      provider.invalidate('jeton-1') // le retardataire
      await expect(provider.getAccessToken()).resolves.toBe('jeton-2')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  it("authentifie la demande sans jamais poser le secret dans l'URL", async () => {
    // Une URL se retrouve dans un log d'accès, un span de trace, un rapport d'erreur. Les
    // identifiants passent par l'en-tête et le corps, jamais par la ligne de requête.
    const fetch = tokenEndpoint({ access_token: 'jeton-1', expires_in: 3600 })
    const provider = createTokenProvider(options(fetch, () => now))

    await provider.getAccessToken()

    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.method).toBe('POST')
    expect(request.url).not.toContain('secret-du-bff')
    expect(request.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('bff-dashboard:secret-du-bff').toString('base64')}`,
    )
    await expect(request.text()).resolves.toContain('grant_type=client_credentials')
  })
})

function options(
  fetch: typeof globalThis.fetch,
  now: () => number,
  extra?: { refreshSkewMs?: number },
) {
  return {
    tokenUrl: 'https://admin.gateway.internal/oauth/token',
    clientId: 'bff-dashboard',
    clientSecret: 'secret-du-bff',
    fetch,
    now,
    ...extra,
  }
}

function tokenResponse(body: { access_token: string; expires_in: unknown }): Response {
  return new Response(JSON.stringify({ token_type: 'Bearer', ...body }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function tokenEndpoint(...bodies: { access_token: string; expires_in: unknown }[]) {
  const fetch = vi.fn()
  for (const body of bodies) fetch.mockResolvedValueOnce(tokenResponse(body))
  return fetch
}
