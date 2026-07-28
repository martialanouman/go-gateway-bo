// @vitest-environment node

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGatewayConfig } from './config'
import { build, closeGatewayClient, getGatewayClient } from './index'

const MOCK_ENV = {
  GATEWAY_MODE: 'mock',
  GATEWAY_ADMIN_BASE_URL: 'http://127.0.0.1:4010',
} as const

describe('assemblage du client', () => {
  it('ne monte ni certificat ni fournisseur de jeton en mode mock', async () => {
    // Monter le transport exigerait des certificats. Un développeur qui lance `pnpm dev` n'en a
    // pas, et ne doit pas être poussé à s'en fabriquer : un certificat d'habitude finit par
    // ressembler à un vrai, et par être commité.
    const assembled = build(
      readGatewayConfig({
        GATEWAY_MODE: 'mock',
        GATEWAY_ADMIN_BASE_URL: 'http://127.0.0.1:4010',
      }),
    )

    expect(assembled.client).toBeDefined()
    await assembled.transport.close()
  })

  it('refuse de monter un client live sans certificats lisibles', () => {
    // Le mTLS ne se dégrade pas en « tant pis, on part sans » : une instance qui démarrerait sans
    // certificat parlerait en clair à une passerelle qui la refuserait, et l'erreur remonterait à
    // la première requête d'écran au lieu du démarrage.
    expect(() =>
      build(
        readGatewayConfig({
          GATEWAY_MODE: 'live',
          GATEWAY_ADMIN_BASE_URL: 'https://admin.gateway.internal/v1',
          GATEWAY_OAUTH_TOKEN_URL: 'https://admin.gateway.internal/oauth/token',
          GATEWAY_OAUTH_CLIENT_ID: 'bff-dashboard',
          GATEWAY_OAUTH_CLIENT_SECRET: 'secret-du-bff',
          GATEWAY_MTLS_CERT_PATH: '/inexistant/client.crt',
          GATEWAY_MTLS_KEY_PATH: '/inexistant/client.key',
          GATEWAY_MTLS_CA_PATH: '/inexistant/ca.crt',
        }),
      ),
    ).toThrow(/GATEWAY_MTLS_CERT_PATH/)
  })
})

describe('assemblage en mode mock', () => {
  it("n'envoie aucun en-tête d'autorisation", async () => {
    // Le mock n'a pas de jeton à présenter, et il ne doit pas en inventer un : un `Bearer` vide
    // serait pris pour une tentative d'authentification ratée par Prism, qui répondrait 401 — et le
    // développeur chercherait longtemps pourquoi son écran ne charge pas.
    let recu: string | undefined | null
    const server = createServer((request, response) => {
      recu = request.headers.authorization ?? null
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [], has_more: false }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    const assembled = build(
      readGatewayConfig({
        GATEWAY_MODE: 'mock',
        GATEWAY_ADMIN_BASE_URL: `http://127.0.0.1:${port}`,
      }),
    )

    await assembled.client.GET('/admin/customers')

    expect(recu).toBeNull()
    await assembled.transport.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})

describe('assemblage en mode live', () => {
  it('monte le transport mTLS et le fournisseur de jeton', async () => {
    // Les certificats sont factices : `undici` ne les valide qu'à l'ouverture d'une connexion, et
    // ce test n'en ouvre aucune. Ce qu'il prouve, c'est l'assemblage — transport porteur des
    // certificats, fournisseur de jeton branché dessus, client construit sur les deux — c'est-à-dire
    // le seul chemin par lequel une instance de production parle à la passerelle.
    const directory = mkdtempSync(join(tmpdir(), 'gateway-mtls-'))
    const files = { cert: 'client.crt', key: 'client.key', ca: 'ca.crt' }
    for (const name of Object.values(files)) {
      writeFileSync(
        join(directory, name),
        '-----BEGIN CERTIFICATE-----\nfactice\n-----END CERTIFICATE-----\n',
      )
    }

    const assembled = build(
      readGatewayConfig({
        GATEWAY_MODE: 'live',
        GATEWAY_ADMIN_BASE_URL: 'https://admin.gateway.internal/v1',
        GATEWAY_OAUTH_TOKEN_URL: 'https://admin.gateway.internal/oauth/token',
        GATEWAY_OAUTH_CLIENT_ID: 'bff-dashboard',
        GATEWAY_OAUTH_CLIENT_SECRET: 'secret-du-bff',
        GATEWAY_MTLS_CERT_PATH: join(directory, files.cert),
        GATEWAY_MTLS_KEY_PATH: join(directory, files.key),
        GATEWAY_MTLS_CA_PATH: join(directory, files.ca),
      }),
    )

    expect(assembled.client).toBeDefined()
    expect(assembled.transport).toBeDefined()
    await assembled.transport.close()
  })
})

describe('getGatewayClient', () => {
  afterEach(async () => {
    await closeGatewayClient()
    for (const key of Object.keys(MOCK_ENV)) delete process.env[key]
  })

  it('construit le client une fois et le partage ensuite', () => {
    // Le partage n'est pas un détail de performance : c'est ce qui garantit qu'une seule et même
    // instance porte le certificat client et le jeton mis en cache. Deux clients, ce serait deux
    // demandes de jeton et deux pools de connexions.
    Object.assign(process.env, MOCK_ENV)

    expect(getGatewayClient()).toBe(getGatewayClient())
  })

  it('refuse de se construire sur un environnement incomplet', async () => {
    await closeGatewayClient()
    delete process.env.GATEWAY_MODE

    expect(() => getGatewayClient()).toThrow(/GATEWAY_MODE/)
  })

  it('reconstruit un client après fermeture', async () => {
    Object.assign(process.env, MOCK_ENV)

    const first = getGatewayClient()
    await closeGatewayClient()

    expect(getGatewayClient()).not.toBe(first)
  })

  it('ne fait rien quand aucun client n’a été construit', async () => {
    await expect(closeGatewayClient()).resolves.toBeUndefined()
  })
})
