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
}

export type TokenProvider = {
  getAccessToken: () => Promise<string>
}

/** Une minute : assez pour couvrir une dérive d'horloge et une requête déjà en vol. */
const DEFAULT_REFRESH_SKEW_MS = 60_000

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  const {
    tokenUrl,
    clientId,
    clientSecret,
    fetch = globalThis.fetch,
    now = Date.now,
    refreshSkewMs = DEFAULT_REFRESH_SKEW_MS,
  } = options

  let cached: { token: string; expiresAt: number } | undefined
  // Une seule demande en vol à la fois. Au démarrage d'une instance, les premiers écrans partent
  // ensemble : sans ce partage, chacun ouvrirait sa propre demande de jeton et le déploiement se
  // traduirait par une rafale sur l'Admin API (invariant e).
  let inFlight: Promise<string> | undefined

  const requestToken = async (): Promise<string> => {
    const response = await fetch(
      new Request(tokenUrl, {
        method: 'POST',
        headers: {
          // RFC 6749 §2.3.1 : les identifiants du client passent par l'en-tête. Jamais par l'URL,
          // qui se retrouve dans un log d'accès ou un span de trace.
          authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      }),
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
    // Un serveur qui n'annonce pas de durée de vie ne se devine pas : on repart d'un jeton neuf au
    // prochain appel plutôt que d'en supposer un valide.
    const lifetimeMs = typeof expires_in === 'number' ? expires_in * 1000 : 0

    cached = { token: access_token, expiresAt: now() + lifetimeMs }
    return access_token
  }

  return {
    async getAccessToken() {
      if (cached && now() < cached.expiresAt - refreshSkewMs) return cached.token
      // Un échec ne se met pas en cache : `inFlight` est relâché quoi qu'il arrive, donc la demande
      // suivante repart de zéro au lieu de rejouer indéfiniment la même erreur.
      inFlight ??= requestToken().finally(() => {
        inFlight = undefined
      })
      return inFlight
    },
  }
}
