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

function tokenResponse(body: { access_token: string; expires_in: number }): Response {
  return new Response(JSON.stringify({ token_type: 'Bearer', ...body }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function tokenEndpoint(...bodies: { access_token: string; expires_in: number }[]) {
  const fetch = vi.fn()
  for (const body of bodies) fetch.mockResolvedValueOnce(tokenResponse(body))
  return fetch
}
