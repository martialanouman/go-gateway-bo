// @vitest-environment node

import { describe, expect, it, type Mock, vi } from 'vitest'
import { createGatewayClient, unwrap } from './client'
import { GatewayError } from './errors'

const baseUrl = 'https://admin.gateway.internal/v1'

// `openapi-fetch` appelle le transport avec une `Request` déjà construite ; le second argument est
// celui que notre client ajoute (le signal de délai). Déclarer la signature ici donne des `calls`
// typés dans les assertions plutôt qu'un tuple vide.
type FetchSignature = (input: Request, init?: RequestInit) => Promise<Response>
type FetchMock = Mock<FetchSignature>

describe('createGatewayClient', () => {
  it('présente le jeton machine sur chaque requête', async () => {
    const fetch = vi.fn<FetchSignature>(async () => json(200, { data: [], has_more: false }))
    const client = createGatewayClient(options(fetch))

    await client.GET('/admin/customers')

    const request = fetch.mock.calls[0]?.[0]
    expect(request?.headers.get('authorization')).toBe('Bearer jeton-machine')
  })

  it('ne réclame le jeton que par le fournisseur — jamais en dur', async () => {
    const getAccessToken = vi.fn(async () => 'jeton-tournant')
    const fetch = vi.fn<FetchSignature>(async () => json(200, { data: [], has_more: false }))
    const client = createGatewayClient({ ...options(fetch), getAccessToken })

    await client.GET('/admin/customers')

    expect(getAccessToken).toHaveBeenCalledTimes(1)
  })

  it('abandonne la requête au bout du délai imparti', async () => {
    // Le tableau de bord ne fait jamais pression sur l'Admin API (invariant e) : une requête qui
    // traîne est abandonnée côté BFF plutôt que de tenir une connexion et un onglet en attente.
    // Le délai est imposé au transport, pas à la `Request` qu'`openapi-fetch` a construite : c'est
    // le signal passé au `fetch` sous-jacent qui doit couper.
    const fetch = vi.fn<FetchSignature>(
      (_request: Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const client = createGatewayClient({ ...options(fetch), timeoutMs: 10 })

    const error = await client.GET('/admin/customers').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).code).toBe('timeout')
  })

  describe('retry', () => {
    it('rejoue une lecture interrompue, une seule fois', async () => {
      const fetch = vi
        .fn<FetchSignature>()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(json(200, { data: [], has_more: false }))
      const client = createGatewayClient(options(fetch))

      const { data } = await client.GET('/admin/customers')

      expect(data).toEqual({ data: [], has_more: false })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('ne rejoue JAMAIS une écriture', async () => {
      // Un POST rejoué crée deux clients. L'échec réseau ne dit pas si la passerelle a traité la
      // requête avant de perdre la connexion — le seul choix sûr est de remonter l'échec.
      const fetch = vi.fn<FetchSignature>().mockRejectedValue(new TypeError('fetch failed'))
      const client = createGatewayClient(options(fetch))

      await expect(
        client.POST('/admin/customers', {
          body: { name: 'ACME', billing_enabled: false, overdraft_enabled: false },
        }),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("s'arrête après une seule reprise", async () => {
      const fetch = vi.fn<FetchSignature>().mockRejectedValue(new TypeError('fetch failed'))
      const client = createGatewayClient(options(fetch))

      await expect(client.GET('/admin/customers')).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })
})

describe('unwrap', () => {
  it('rend les données quand la passerelle répond 2xx', async () => {
    const fetch = vi.fn<FetchSignature>(async () => json(200, { data: [], has_more: false }))
    const client = createGatewayClient(options(fetch))

    await expect(unwrap(await client.GET('/admin/customers'))).resolves.toEqual({
      data: [],
      has_more: false,
    })
  })

  it("transforme l'enveloppe d'erreur du contrat en `GatewayError`", async () => {
    const fetch = vi.fn<FetchSignature>(async () =>
      json(403, { code: 'forbidden_scope', message: 'Scope manquant.' }),
    )
    const client = createGatewayClient(options(fetch))

    const error = await unwrap(await client.GET('/admin/customers')).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(GatewayError)
    expect((error as GatewayError).code).toBe('forbidden_scope')
    expect((error as GatewayError).status).toBe(403)
  })
})

function options(fetch: FetchMock) {
  return {
    baseUrl,
    fetch: fetch as unknown as typeof globalThis.fetch,
    getAccessToken: async () => 'jeton-machine',
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
