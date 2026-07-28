// @vitest-environment node

/**
 * Invariant (a), en test bloquant.
 *
 * Deux moitiés, et la seconde est celle qui compte :
 *
 * 1. **L'oracle se prouve lui-même.** Il doit échouer sur un cas fabriqué, sinon les tests qui s'y
 *    appuient seraient verts quoi qu'il arrive.
 * 2. **Il est branché sur les chemins qui existent déjà.** Aucun écran n'affiche encore de corps de
 *    message — la surface CDR arrive en M5 — mais le proxy vers l'API Admin, la traduction d'erreur
 *    et la configuration, eux, sont livrés. Un corps peut donc *déjà* transiter dans une réponse et
 *    ressortir par un log d'erreur. Un test qui n'exercerait que l'oracle donnerait l'illusion que
 *    l'invariant est gardé pendant six jalons où il ne le serait pas.
 */

import { inspect } from 'node:util'
import { describe, expect, it, type Mock, vi } from 'vitest'
import { createGatewayClient, unwrap } from '~/server/gateway/client'
import { toGatewayError } from '~/server/gateway/errors'
import { assertNoMessageBody, containsMessageBody, MESSAGE_BODY_SENTINEL } from './invariants'

/** `openapi-fetch` appelle le transport avec une `Request` déjà construite. */
type FetchSignature = (input: Request, init?: RequestInit) => Promise<Response>

describe("l'oracle de l'invariant (a)", () => {
  it('échoue quand le corps apparaît en clair', () => {
    expect(() =>
      assertNoMessageBody([{ what: 'une ligne de log', text: `INFO ${MESSAGE_BODY_SENTINEL}` }]),
    ).toThrow(/Invariant \(a\) violé/)
  })

  it('échoue quand le corps a été tronqué', () => {
    // Un extrait de vingt caractères reste une fuite. C'est pour cela que la sentinelle répète un
    // noyau court plutôt que d'être une longue phrase unique.
    expect(
      containsMessageBody([{ what: 'un extrait', text: MESSAGE_BODY_SENTINEL.slice(0, 20) }]),
    ).toBe(true)
  })

  it.each([
    ['base64', Buffer.from('ZQX7-CORPS', 'utf8').toString('base64')],
    ['hexadécimal', Buffer.from('ZQX7-CORPS', 'utf8').toString('hex')],
    ['pourcentage', encodeURIComponent('ZQX7-CORPS')],
  ])('échoue quand le corps est encodé en %s', (_forme, encoded) => {
    expect(containsMessageBody([{ what: 'une URL', text: `?q=${encoded}` }])).toBe(true)
  })

  it('reste silencieux sur un contenu qui ne porte pas de corps', () => {
    expect(() =>
      assertNoMessageBody([
        { what: 'un log ordinaire', text: 'GET /admin/customers 200 · 12 ms' },
        { what: 'une erreur', text: 'Admin API 403 — forbidden_scope' },
      ]),
    ).not.toThrow()
  })
})

describe('les chemins livrés ne laissent pas fuir un corps', () => {
  it("la traduction d'erreur n'emporte rien du corps de la réponse", async () => {
    // Le cas réel : la passerelle refuse une opération et fait figurer, dans son message ou son
    // détail de validation, la valeur qu'elle refuse — c'est-à-dire le corps du message.
    const response = new Response(
      JSON.stringify({
        code: 'validation_error',
        message: `Le champ text est invalide : « ${MESSAGE_BODY_SENTINEL} »`,
        errors: [{ field: 'text', message: `valeur refusée : ${MESSAGE_BODY_SENTINEL}` }],
        body: MESSAGE_BODY_SENTINEL,
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    )

    const error = await toGatewayError(response)

    assertNoMessageBody([
      { what: "le message de l'erreur", text: error.message },
      { what: "la sérialisation JSON de l'erreur", text: JSON.stringify(error) },
      // `util.inspect` est ce que produit `console.error(err)` : il sérialise toutes les propriétés
      // propres énumérables, pas seulement `message`.
      { what: "l'inspection de l'erreur, telle qu'un logger la produit", text: inspect(error) },
      { what: "la pile de l'erreur", text: error.stack ?? '' },
    ])
  })

  it("une réponse d'erreur remontée par le client ne porte pas le corps", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'internal_error', message: MESSAGE_BODY_SENTINEL }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const client = createGatewayClient({
      baseUrl: 'https://admin.gateway.internal/v1',
      fetch: fetch as unknown as typeof globalThis.fetch,
      getAccessToken: async () => 'jeton-machine',
    })

    const error = await unwrap(await client.GET('/admin/customers')).catch((e: unknown) => e)

    assertNoMessageBody([
      { what: "l'erreur rendue à l'appelant", text: inspect(error) },
      { what: 'sa sérialisation', text: JSON.stringify(error) },
    ])
  })

  it("l'URL construite par le client ne transporte jamais de corps", async () => {
    // Une URL se retrouve dans un log d'accès, un span de trace, un rapport d'erreur. C'est le
    // chemin de fuite le plus banal, et le plus difficile à rattraper après coup.
    const fetch: Mock<FetchSignature> = vi.fn<FetchSignature>(
      async () =>
        new Response(JSON.stringify({ data: [], has_more: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const client = createGatewayClient({
      baseUrl: 'https://admin.gateway.internal/v1',
      fetch: fetch as unknown as typeof globalThis.fetch,
      getAccessToken: async () => 'jeton-machine',
    })

    await client.GET('/admin/customers', { params: { query: { status: 'active' } } })

    const request = fetch.mock.calls[0]?.[0]
    expect(request).toBeDefined()
    assertNoMessageBody([
      { what: "l'URL de la requête sortante", text: request?.url ?? '' },
      { what: 'ses en-têtes', text: JSON.stringify([...(request?.headers ?? [])]) },
    ])
  })
})
