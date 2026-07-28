// @vitest-environment node

// Ces tests font passer de vraies requêtes par le transport, contre un serveur HTTP local.
//
// Sans eux, un défaut structurel est resté invisible : le transport passait la `Request` construite
// par `openapi-fetch` — donc issue de la copie d'undici embarquée dans Node — au `fetch` du paquet
// npm `undici`, qui ne reconnaît pas cette classe, la convertit en chaîne et échoue sur
// « Failed to parse URL from [object Request] ». Le mode `live` échouait à chaque appel, et l'erreur
// se présentait comme une panne réseau de la passerelle.

import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTransport } from './transport'

let server: Server
let received: { method: string; url: string; authorization?: string; body: string }[] = []
let baseUrl = ''

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('createTransport', () => {
  it('achemine une requête et rend la réponse', async () => {
    received = []
    const transport = createTransport()

    const response = await transport.fetch(
      new Request(`${baseUrl}/admin/customers`, { headers: { authorization: 'Bearer jeton' } }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(received[0]?.method).toBe('GET')
    expect(received[0]?.url).toBe('/admin/customers')
    expect(received[0]?.authorization).toBe('Bearer jeton')
    await transport.close()
  })

  it('achemine le corps d’une écriture', async () => {
    received = []
    const transport = createTransport()

    await transport.fetch(
      new Request(`${baseUrl}/admin/customers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ACME' }),
      }),
    )

    expect(received[0]?.method).toBe('POST')
    expect(received[0]?.body).toBe('{"name":"ACME"}')
    await transport.close()
  })

  it('transmet le signal d’abandon fourni par l’appelant', async () => {
    const transport = createTransport()

    await expect(
      transport.fetch(new Request(`${baseUrl}/admin/customers`), {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow()

    await transport.close()
  })

  it('refuse de démarrer quand un certificat est illisible', () => {
    expect(() =>
      createTransport({
        certPath: '/inexistant/client.crt',
        keyPath: '/inexistant/client.key',
        caPath: '/inexistant/ca.crt',
      }),
    ).toThrow(/GATEWAY_MTLS_CERT_PATH/)
  })
})
