// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readGatewayConfig } from './config'

const live = {
  GATEWAY_MODE: 'live',
  GATEWAY_ADMIN_BASE_URL: 'https://admin.gateway.internal/v1',
  GATEWAY_OAUTH_TOKEN_URL: 'https://admin.gateway.internal/oauth/token',
  GATEWAY_OAUTH_CLIENT_ID: 'bff-dashboard',
  GATEWAY_OAUTH_CLIENT_SECRET: 'secret-du-bff',
  GATEWAY_MTLS_CERT_PATH: '/etc/bff/tls/client.crt',
  GATEWAY_MTLS_KEY_PATH: '/etc/bff/tls/client.key',
  GATEWAY_MTLS_CA_PATH: '/etc/bff/tls/ca.crt',
}

describe('readGatewayConfig', () => {
  it('lit une configuration live complète', () => {
    const config = readGatewayConfig(live)

    expect(config.mode).toBe('live')
    expect(config.baseUrl).toBe('https://admin.gateway.internal/v1')
    expect(config.mode === 'live' && config.mtls.certPath).toBe('/etc/bff/tls/client.crt')
  })

  it("n'invente aucun mode par défaut", () => {
    // Un défaut serait piégeux dans les deux sens : `live` ferait partir une production vers une
    // passerelle mal configurée, `mock` ferait servir des données inventées en croyant les vraies.
    // La variable est obligatoire, et son absence se voit au démarrage.
    const { GATEWAY_MODE: _, ...withoutMode } = live

    expect(() => readGatewayConfig(withoutMode)).toThrow(/GATEWAY_MODE/)
  })

  it('exige les identifiants et les certificats en mode live', () => {
    const { GATEWAY_MTLS_KEY_PATH: _, ...withoutKey } = live

    expect(() => readGatewayConfig(withoutKey)).toThrow(/GATEWAY_MTLS_KEY_PATH/)
  })

  it("n'exige ni identifiants ni certificats en mode mock", () => {
    // Le mock ne demande ni OAuth ni mTLS : exiger un secret pour lancer `pnpm dev` pousserait
    // chacun à s'en inventer un, et un secret d'habitude finit par ressembler à un vrai.
    const config = readGatewayConfig({
      GATEWAY_MODE: 'mock',
      GATEWAY_ADMIN_BASE_URL: 'http://127.0.0.1:4010',
    })

    expect(config.mode).toBe('mock')
    expect(config.baseUrl).toBe('http://127.0.0.1:4010')
  })

  it('refuse un mode inconnu plutôt que de le traiter comme mock', () => {
    expect(() => readGatewayConfig({ ...live, GATEWAY_MODE: 'staging' })).toThrow(/GATEWAY_MODE/)
  })

  it("refuse une base URL qui n'en est pas une", () => {
    expect(() => readGatewayConfig({ ...live, GATEWAY_ADMIN_BASE_URL: 'admin.gateway' })).toThrow(
      /GATEWAY_ADMIN_BASE_URL/,
    )
  })

  it('ne laisse jamais un secret transparaître dans le message levé', () => {
    const { GATEWAY_MTLS_CERT_PATH: _, ...incomplete } = live

    const error = (() => {
      try {
        readGatewayConfig(incomplete)
        return undefined
      } catch (e) {
        return e as Error
      }
    })()

    expect(error?.message).not.toContain('secret-du-bff')
  })
})
