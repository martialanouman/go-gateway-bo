/**
 * Le client typé vers l'API Admin de la passerelle.
 *
 * **Ce module ne s'importe que depuis `src/server/`.** Le jeton machine, le mTLS et l'adresse
 * interne de la passerelle n'ont rien à faire dans un bundle navigateur ; une règle de lint le
 * refuse depuis `src/routes/` et `src/components/` (invariant d).
 *
 * Les types viennent du contrat publié, jamais d'une copie locale : `paths` est généré depuis
 * `openapi-admin.yaml` par le dépôt `go-gateway`. Un endpoint qui manque se corrige par une PR
 * là-bas, pas par un contournement ici.
 */

import type { paths } from '@martialanouman/gateway-api-contracts/admin'
import createClient, { type Client, type Middleware } from 'openapi-fetch'
import { GATEWAY_TRANSPORT_CODES, GatewayError, gatewayErrorFromEnvelope } from './errors'

export type GatewayClientOptions = {
  baseUrl: string
  /** Fournit le jeton machine. Une chaîne vide n'envoie aucun en-tête d'autorisation. */
  getAccessToken: () => Promise<string>
  /** Point d'injection du transport — c'est par là que passe le mTLS. */
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Court volontairement. Le tableau de bord n'est jamais sur le chemin critique du plan de données
 * (invariant e) : mieux vaut un écran qui dit « la passerelle ne répond pas » qu'un écran qui
 * attend, en tenant une connexion vers une passerelle déjà en peine.
 */
const DEFAULT_TIMEOUT_MS = 10_000

/** Sans corps à rejouer et sans effet à dupliquer : ces deux méthodes seules se reprennent. */
const REPLAYABLE_METHODS = new Set(['GET', 'HEAD'])

export function createGatewayClient(options: GatewayClientOptions): Client<paths> {
  const {
    baseUrl,
    getAccessToken,
    fetch = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const client = createClient<paths>({
    baseUrl,
    fetch: (request) => send(request, { fetch, timeoutMs }),
  })

  client.use(bearerToken(getAccessToken))
  return client
}

/**
 * Rend les données d'une réponse, ou lève l'erreur du contrat.
 *
 * `openapi-fetch` rend `{ data, error }` et laisse l'appelant trancher — pratique pour un client
 * générique, dangereux ici : un `error` ignoré se lit comme un écran vide. Passer par `unwrap` rend
 * l'oubli impossible.
 */
export async function unwrap<T>(result: {
  data?: T
  error?: unknown
  response: Response
}): Promise<T> {
  if (result.error !== undefined) {
    throw gatewayErrorFromEnvelope(result.response.status, result.error)
  }
  if (!result.response.ok) {
    throw new GatewayError(result.response.status, GATEWAY_TRANSPORT_CODES.unexpected)
  }
  return result.data as T
}

function bearerToken(getAccessToken: () => Promise<string>): Middleware {
  return {
    async onRequest({ request }) {
      const token = await getAccessToken()
      if (token) request.headers.set('authorization', `Bearer ${token}`)
      return request
    },
  }
}

async function send(
  request: Request,
  { fetch, timeoutMs }: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<Response> {
  try {
    return await attempt(request, { fetch, timeoutMs })
  } catch (error) {
    // Une reprise n'a de sens que si la requête n'a pas pu produire d'effet et si personne n'a
    // demandé l'arrêt. Rejouer un abandon volontaire doublerait le délai que l'on vient d'imposer.
    if (!REPLAYABLE_METHODS.has(request.method) || isAbort(error)) throw asGatewayError(error)

    try {
      return await attempt(request, { fetch, timeoutMs })
    } catch (retryError) {
      throw asGatewayError(retryError)
    }
  }
}

function attempt(
  request: Request,
  { fetch, timeoutMs }: { fetch: typeof globalThis.fetch; timeoutMs: number },
): Promise<Response> {
  // Le signal de la requête est conservé : un appelant qui annule (navigation, démontage de
  // composant) doit continuer d'être entendu. Le délai vient s'y ajouter, il ne le remplace pas.
  const signal = request.signal
    ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)

  return fetch(request, { signal })
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function asGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error

  const code = isAbort(error) ? GATEWAY_TRANSPORT_CODES.timeout : GATEWAY_TRANSPORT_CODES.network
  return new GatewayError(0, code)
}
