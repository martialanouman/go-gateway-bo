// @vitest-environment node

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

describe('getGatewayClient', () => {
  afterEach(async () => {
    await closeGatewayClient()
    for (const key of Object.keys(MOCK_ENV)) process.env[key] = undefined
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
    process.env.GATEWAY_MODE = undefined

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
