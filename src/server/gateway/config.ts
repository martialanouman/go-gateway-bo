/**
 * Configuration de l'accès à l'API Admin, lue dans l'environnement.
 *
 * Rien n'a de valeur par défaut silencieuse. Un défaut se traduit toujours par la même panne : une
 * instance démarre, sert des écrans, et personne ne sait avant longtemps qu'elle parlait au mauvais
 * endroit. Une variable manquante fait échouer le démarrage, avec son nom dans le message.
 */

export type GatewayMode = 'live' | 'mock'

export type MtlsPaths = {
  certPath: string
  keyPath: string
  caPath: string
}

export type GatewayConfig =
  | {
      mode: 'mock'
      baseUrl: string
      timeoutMs: number | undefined
    }
  | {
      mode: 'live'
      baseUrl: string
      timeoutMs: number | undefined
      oauth: {
        tokenUrl: string
        clientId: string
        clientSecret: string
      }
      mtls: MtlsPaths
    }

export type EnvironmentLike = Record<string, string | undefined>

export function readGatewayConfig(env: EnvironmentLike): GatewayConfig {
  const mode = env.GATEWAY_MODE
  if (mode !== 'live' && mode !== 'mock') {
    throw new ConfigurationError(
      `GATEWAY_MODE doit valoir 'live' ou 'mock'. Valeur lue : ${mode ? `'${mode}'` : 'absente'}.`,
    )
  }

  const baseUrl = requiredUrl(env, 'GATEWAY_ADMIN_BASE_URL')
  const timeoutMs = optionalPositiveInteger(env, 'GATEWAY_TIMEOUT_MS')

  if (mode === 'mock') return { mode, baseUrl, timeoutMs }

  return {
    mode,
    baseUrl,
    timeoutMs,
    oauth: {
      tokenUrl: requiredUrl(env, 'GATEWAY_OAUTH_TOKEN_URL'),
      clientId: required(env, 'GATEWAY_OAUTH_CLIENT_ID'),
      clientSecret: required(env, 'GATEWAY_OAUTH_CLIENT_SECRET'),
    },
    mtls: {
      certPath: required(env, 'GATEWAY_MTLS_CERT_PATH'),
      keyPath: required(env, 'GATEWAY_MTLS_KEY_PATH'),
      caPath: required(env, 'GATEWAY_MTLS_CA_PATH'),
    },
  }
}

/**
 * Ne cite jamais la valeur d'une variable qui peut porter un secret — seulement son nom. Un message
 * d'erreur de démarrage part dans les logs de l'orchestrateur, et la variable manquante est souvent
 * voisine d'un secret. Seule exception, `GATEWAY_MODE` : son domaine est fermé à deux valeurs
 * publiques, et voir la valeur refusée est ce qui rend la faute de frappe évidente.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

function required(env: EnvironmentLike, name: string): string {
  const value = env[name]
  if (!value) throw new ConfigurationError(`${name} est requise et absente de l'environnement.`)
  return value
}

function requiredUrl(env: EnvironmentLike, name: string): string {
  const value = required(env, name)
  if (!URL.canParse(value)) {
    throw new ConfigurationError(`${name} doit être une URL absolue (schéma compris).`)
  }
  return value
}

function optionalPositiveInteger(env: EnvironmentLike, name: string): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw === '') return undefined

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(
      `${name} doit être un entier de millisecondes strictement positif.`,
    )
  }
  return value
}
