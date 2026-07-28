/**
 * Le client typé vers l'API Admin de la passerelle.
 *
 * **Ce module ne s'importe que depuis `src/server/`.** Le jeton machine, le mTLS et l'adresse
 * interne de la passerelle n'ont rien à faire dans un bundle navigateur ; une règle de lint le
 * refuse depuis le code client, et un test d'invariant vérifie la chaîne complète des imports.
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
  /**
   * Jette le jeton en cache. Sans cela, une passerelle qui révoque un jeton avant son expiration
   * annoncée fige le tableau de bord sur des 401 jusqu'au redémarrage du processus.
   */
  invalidateToken?: (token: string) => void
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

/** Sans effet à dupliquer : ces deux méthodes seules se reprennent après un échec de transport. */
const REPLAYABLE_METHODS = new Set(['GET', 'HEAD'])

/** Statuts pour lesquels la spécification interdit un corps. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

type SendContext = {
  fetch: typeof globalThis.fetch
  timeoutMs: number
  getAccessToken: () => Promise<string>
  invalidateToken: ((token: string) => void) | undefined
}

export function createGatewayClient(options: GatewayClientOptions): Client<paths> {
  const {
    baseUrl,
    getAccessToken,
    invalidateToken,
    fetch = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const context: SendContext = { fetch, timeoutMs, getAccessToken, invalidateToken }

  const client = createClient<paths>({
    baseUrl,
    fetch: (request) => send(request, context),
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

async function send(request: Request, context: SendContext): Promise<Response> {
  // Cloné avant tout envoi : le transport consomme le corps, et une `Request` déjà utilisée ne se
  // rejoue pas (« Cannot construct a Request with a Request object that has already been used »).
  const spare = request.clone()

  let response: Response
  try {
    response = await attempt(request, context)
  } catch (error) {
    // Une reprise n'a de sens que si la requête n'a pas pu produire d'effet et si personne n'a
    // demandé l'arrêt. Rejouer un abandon volontaire doublerait le délai que l'on vient d'imposer.
    if (!REPLAYABLE_METHODS.has(request.method) || isAbort(error)) throw asGatewayError(error)

    try {
      response = await attempt(spare.clone(), context)
    } catch (retryError) {
      throw asGatewayError(retryError)
    }
  }

  if (response.status !== 401 || !context.invalidateToken) return response

  // Un 401 signifie que la passerelle n'a rien exécuté : rejouer est sûr, y compris sur une
  // écriture. C'est le seul cas où une méthode non idempotente se reprend.
  return retryWithFreshToken(spare, response, context)
}

async function retryWithFreshToken(
  spare: Request,
  unauthorized: Response,
  context: SendContext,
): Promise<Response> {
  const presented = spare.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!presented) return unauthorized

  context.invalidateToken?.(presented)
  const refreshed = await context.getAccessToken().catch(() => '')
  // Un jeton inchangé signifie que le renouvellement n'a rien donné : rejouer produirait le même
  // 401 et une requête de plus vers une passerelle qui refuse déjà.
  if (!refreshed || refreshed === presented) return unauthorized

  const replay = spare.clone()
  replay.headers.set('authorization', `Bearer ${refreshed}`)

  try {
    return await attempt(replay, context)
  } catch (error) {
    throw asGatewayError(error)
  }
}

/**
 * Une tentative, corps compris.
 *
 * Le corps est lu **ici**, sous la même garde de délai que les en-têtes, puis la réponse est rendue
 * détachée du transport. Sans cela, `openapi-fetch` lirait le corps après le retour de cette
 * fonction : une réponse volumineuse coupée en cours de lecture lèverait un `DOMException` brut,
 * hors de toute traduction, et l'appelant recevrait une erreur sans `code` exploitable.
 */
async function attempt(request: Request, context: SendContext): Promise<Response> {
  // `AbortSignal.timeout` ne se désarme pas : chaque requête laisserait un minuteur armé jusqu'à
  // son terme. Un contrôleur explicite s'annule dès la réponse entièrement lue.
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Délai dépassé.', 'TimeoutError'))
  }, context.timeoutMs)

  const signal = request.signal
    ? AbortSignal.any([request.signal, controller.signal])
    : controller.signal

  try {
    const response = await context.fetch(request, { signal })
    const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer()

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } finally {
    clearTimeout(timer)
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}

function asGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error

  const code = isAbort(error) ? GATEWAY_TRANSPORT_CODES.timeout : GATEWAY_TRANSPORT_CODES.network
  return new GatewayError(0, code)
}
