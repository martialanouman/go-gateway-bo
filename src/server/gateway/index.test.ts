// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readGatewayConfig } from './config'
import { build } from './index'

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
