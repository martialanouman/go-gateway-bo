/**
 * Point d'entrée unique vers l'API Admin.
 *
 * Le client est construit **une fois** et partagé : c'est ce qui garantit que toute requête sortante
 * passe par le même transport, donc par le même certificat client et le même jeton mis en cache.
 * Un `createGatewayClient` appelé ailleurs repartirait sur le `fetch` global — sans mTLS, sans
 * jeton, et sans que rien ne le signale. Une règle de lint interdit cet appel hors de ce dossier.
 */

import { createGatewayClient } from './client'
import { type GatewayConfig, readGatewayConfig } from './config'
import { createTokenProvider } from './token'
import { createMtlsTransport, type Transport } from './transport'

let instance: { client: ReturnType<typeof createGatewayClient>; transport?: Transport } | undefined

/** Le client typé vers l'API Admin. Construit au premier appel, partagé ensuite. */
export function getGatewayClient(): ReturnType<typeof createGatewayClient> {
  instance ??= build(readGatewayConfig(process.env))
  return instance.client
}

/** Libère le transport. Réservé à l'arrêt du processus et aux tests. */
export async function closeGatewayClient(): Promise<void> {
  await instance?.transport?.close()
  instance = undefined
}

export function build(config: GatewayConfig) {
  // En mock, ni certificat ni jeton : Prism sert le contrat en clair sur la boucle locale. Exiger
  // un secret pour lancer `pnpm dev` pousserait chacun à s'en inventer un.
  if (config.mode === 'mock') {
    return {
      client: createGatewayClient({
        baseUrl: config.baseUrl,
        getAccessToken: async () => '',
        timeoutMs: config.timeoutMs,
      }),
    }
  }

  const transport = createMtlsTransport(config.mtls)
  // L'endpoint de jeton vit sur le même réseau interne et exige le même certificat client : il
  // emprunte le transport plutôt que le `fetch` global.
  const tokens = createTokenProvider({ ...config.oauth, fetch: transport.fetch })

  return {
    transport,
    client: createGatewayClient({
      baseUrl: config.baseUrl,
      getAccessToken: tokens.getAccessToken,
      fetch: transport.fetch,
      timeoutMs: config.timeoutMs,
    }),
  }
}

export { unwrap } from './client'
export { GatewayError, type GatewayFieldError } from './errors'
