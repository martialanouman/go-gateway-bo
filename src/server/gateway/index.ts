/**
 * Point d'entrée unique vers l'API Admin.
 *
 * Le client est construit **une fois** et partagé : c'est ce qui garantit que toute requête sortante
 * passe par le même transport, donc par le même certificat client et le même jeton mis en cache. Un
 * `createGatewayClient` appelé ailleurs repartirait sur le `fetch` global — sans mTLS, sans jeton,
 * et sans que rien ne le signale à l'exécution. Le reste du BFF passe donc par `getGatewayClient`,
 * jamais par le constructeur.
 */

import { createGatewayClient } from './client'
import { type GatewayConfig, readGatewayConfig } from './config'
import { createTokenProvider } from './token'
import { createTransport, type Transport } from './transport'

type Assembled = {
  client: ReturnType<typeof createGatewayClient>
  transport: Transport
}

let instance: Assembled | undefined

/** Le client typé vers l'API Admin. Construit au premier appel, partagé ensuite. */
export function getGatewayClient(): ReturnType<typeof createGatewayClient> {
  instance ??= build(readGatewayConfig(process.env))
  return instance.client
}

/** Libère le transport. Réservé à l'arrêt du processus et aux tests. */
export async function closeGatewayClient(): Promise<void> {
  await instance?.transport.close()
  instance = undefined
}

export function build(config: GatewayConfig): Assembled {
  // En mock, ni certificat ni jeton : Prism sert le contrat en clair sur la boucle locale. Exiger
  // un secret pour lancer `pnpm dev` pousserait chacun à s'en inventer un — et un secret d'habitude
  // finit par ressembler à un vrai.
  if (config.mode === 'mock') {
    const transport = createTransport()
    return {
      transport,
      client: createGatewayClient({
        baseUrl: config.baseUrl,
        getAccessToken: async () => '',
        fetch: transport.fetch,
        timeoutMs: config.timeoutMs,
      }),
    }
  }

  const transport = createTransport(config.mtls)
  // L'endpoint de jeton vit sur le même réseau interne et exige le même certificat client : il
  // emprunte le transport plutôt que le `fetch` global.
  const tokens = createTokenProvider({ ...config.oauth, fetch: transport.fetch })

  return {
    transport,
    client: createGatewayClient({
      baseUrl: config.baseUrl,
      getAccessToken: tokens.getAccessToken,
      invalidateToken: tokens.invalidate,
      fetch: transport.fetch,
      timeoutMs: config.timeoutMs,
    }),
  }
}

export { unwrap } from './client'
export { GATEWAY_TRANSPORT_CODES, GatewayError, type GatewayFieldError } from './errors'
