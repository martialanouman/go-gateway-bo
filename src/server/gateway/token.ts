/**
 * Jeton machine de l'API Admin (OAuth2 `client_credentials`).
 *
 * Ce jeton porte des **scopes fixes**, dont `content:read`. Il ne représente pas l'opérateur
 * connecté et ne dépend pas de lui : la passerelle voit toujours le même client. La restriction par
 * opérateur est donc entièrement à la charge du BFF (invariant c) — aucun contrôle d'accès ne peut
 * être délégué à l'Admin API, et le supposer serait une faille silencieuse.
 */

import { GATEWAY_TRANSPORT_CODES, GatewayError, toGatewayError } from './errors'

export type TokenProviderOptions = {
  tokenUrl: string
  clientId: string
  clientSecret: string
  /** Injecté pour porter le mTLS ; `globalThis.fetch` par défaut. */
  fetch?: typeof globalThis.fetch
  /** Injectée par les tests ; `Date.now` en production. */
  now?: () => number
  /** Marge de renouvellement anticipé. */
  refreshSkewMs?: number
  /** Délai propre à la demande de jeton. */
  timeoutMs?: number
}

export type TokenProvider = {
  getAccessToken: () => Promise<string>
  /**
   * Jette le jeton en cache s'il est bien celui présenté. Comparer évite de jeter un jeton qui
   * vient d'être renouvelé par une autre requête en vol — sinon deux 401 concurrents provoquent
   * deux renouvellements en chaîne.
   */
  invalidate: (token: string) => void
}

/** Une minute : assez pour couvrir une dérive d'horloge et une requête déjà en vol. */
const DEFAULT_REFRESH_SKEW_MS = 60_000

/**
 * Repli quand le serveur n'annonce pas de durée de vie — `expires_in` est OPTIONAL au sens de la
 * RFC 6749 §4.2.2. Cinq minutes : assez court pour qu'un jeton révoqué ne traîne pas, assez long
 * pour ne pas transformer chaque appel d'écran en aller-retour d'authentification.
 */
const FALLBACK_LIFETIME_MS = 300_000

/** Plus court que celui des appels métier : l'authentification précède tout le reste. */
const DEFAULT_TIMEOUT_MS = 5_000

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  const {
    tokenUrl,
    clientId,
    clientSecret,
    fetch = globalThis.fetch,
    now = Date.now,
    refreshSkewMs = DEFAULT_REFRESH_SKEW_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  let cached: { token: string; renewAt: number } | undefined
  // Une seule demande en vol à la fois. Au démarrage d'une instance, les premiers écrans partent
  // ensemble : sans ce partage, chacun ouvrirait sa propre demande de jeton et le déploiement se
  // traduirait par une rafale sur l'Admin API (invariant e).
  let inFlight: Promise<string> | undefined

  const requestToken = async (): Promise<string> => {
    const response = await fetch(
      new Request(tokenUrl, {
        method: 'POST',
        headers: {
          // RFC 6749 §2.3.1 : les identifiants du client passent par l'en-tête, chacun
          // percent-encodé, et l'ensemble encodé en base64 depuis de l'UTF-8. `btoa` encoderait en
          // Latin-1 — un secret accentué produirait un credential silencieusement faux, un secret
          // contenant un caractère hors Latin-1 lèverait une exception non typée.
          authorization: `Basic ${basicCredentials(clientId, clientSecret)}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      }),
      { signal: AbortSignal.timeout(timeoutMs) },
    )

    if (!response.ok) throw await toGatewayError(response)

    const payload: unknown = await response.json().catch(() => undefined)
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { access_token?: unknown }).access_token !== 'string'
    ) {
      throw new GatewayError(response.status, GATEWAY_TRANSPORT_CODES.unexpected)
    }

    const { access_token, expires_in } = payload as { access_token: string; expires_in?: unknown }

    const lifetime = lifetimeMs(expires_in)
    // La marge ne dépasse jamais la moitié de la durée de vie : sur un jeton court, une marge fixe
    // d'une minute laisserait une fenêtre utile nulle ou négative, et chaque appel Admin serait
    // précédé d'une demande de jeton.
    const skew = Math.min(refreshSkewMs, lifetime / 2)
    cached = { token: access_token, renewAt: now() + lifetime - skew }
    return access_token
  }

  return {
    async getAccessToken() {
      if (cached && now() < cached.renewAt) return cached.token
      // Un échec ne se met pas en cache : `inFlight` est relâché quoi qu'il arrive, donc la demande
      // suivante repart de zéro au lieu de rejouer indéfiniment la même erreur.
      inFlight ??= requestToken()
        .catch((error: unknown) => {
          throw error instanceof GatewayError
            ? error
            : new GatewayError(0, GATEWAY_TRANSPORT_CODES.authentication)
        })
        .finally(() => {
          inFlight = undefined
        })
      return inFlight
    },

    invalidate(token: string) {
      if (cached?.token === token) cached = undefined
    },
  }
}

/**
 * Une durée de vie absente, textuelle ou aberrante ne doit jamais devenir zéro : le jeton serait
 * alors périmé dès sa mise en cache, et **chaque** appel Admin serait précédé d'une demande de
 * jeton — un doublement permanent du trafic vers la passerelle, sans plafond (invariant e).
 *
 * `Number` accepte la forme textuelle que renvoient plusieurs serveurs OAuth (`"3600"`) ;
 * `isFinite` écarte `NaN`, que `typeof … === 'number'` laisserait passer. Une valeur courte mais
 * légitime est respectée telle quelle — c'est la marge qui s'adapte, jamais la durée annoncée, sous
 * peine de présenter un jeton après son expiration.
 */
function lifetimeMs(expiresIn: unknown): number {
  const seconds = Number(expiresIn)
  if (!Number.isFinite(seconds) || seconds <= 0) return FALLBACK_LIFETIME_MS
  return seconds * 1000
}

function basicCredentials(clientId: string, clientSecret: string): string {
  const pair = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`
  return Buffer.from(pair, 'utf8').toString('base64')
}
