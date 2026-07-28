/**
 * Traduction de l'enveloppe d'erreur plate de l'API Admin (`{ code, message, errors[] }`) vers une
 * erreur du BFF.
 *
 * Deux choix méritent d'être explicites, parce qu'ils ne sont pas les choix par défaut :
 *
 * 1. **Le texte du serveur n'est jamais conservé.** `Error.message` ne contient que le statut HTTP
 *    et le `code` stable du contrat. Une erreur finit dans un log, un span, un rapport — et rien ne
 *    garantit qu'un message d'erreur de la passerelle ne recopie pas une valeur qu'on lui a passée.
 *    L'invariant (a) interdit que le corps d'un message sorte de l'onglet qui l'affiche ; la façon
 *    sûre de tenir cette promesse est de ne jamais laisser entrer du texte libre distant.
 * 2. **Le `code` est ce qui compte.** Il est stable, greppable, et partagé avec `command_status`
 *    côté SMPP. C'est lui que l'interface traduit en copie française — pas le message anglais du
 *    serveur, qui n'a jamais été écrit pour un opérateur.
 */

/** Détail de validation par champ, tel que décrit par le contrat. */
export type GatewayFieldError = {
  readonly field: string
  readonly message: string
}

/** Codes produits par le BFF lui-même, quand la réponse ne vient pas du contrat. */
export const GATEWAY_TRANSPORT_CODES = {
  /** La passerelle n'a pas répondu dans le délai imparti. */
  timeout: 'timeout',
  /** La connexion a échoué : DNS, TLS, réseau. */
  network: 'network_error',
  /** Réponse d'un intermédiaire (proxy, load balancer) qui ne parle pas le contrat. */
  upstream: 'upstream_unavailable',
  /** 2xx ou 4xx dont le corps ne suit pas l'enveloppe attendue. */
  unexpected: 'unexpected_response',
} as const

export class GatewayError extends Error {
  /** Code stable du contrat, ou l'un de `GATEWAY_TRANSPORT_CODES`. */
  readonly code: string
  /** Statut HTTP ; `0` quand la requête n'a jamais abouti. */
  readonly status: number
  /** Détail par champ sur une erreur de validation ; vide sinon. */
  readonly fieldErrors: readonly GatewayFieldError[]

  constructor(status: number, code: string, fieldErrors: readonly GatewayFieldError[] = []) {
    super(`Admin API ${status} — ${code}`)
    this.name = 'GatewayError'
    this.code = code
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/**
 * Construit l'erreur à partir d'un corps déjà désérialisé — le cas d'`openapi-fetch`, qui a
 * consommé la réponse avant de nous la rendre.
 */
export function gatewayErrorFromEnvelope(status: number, envelope: unknown): GatewayError {
  if (!isRecord(envelope) || typeof envelope.code !== 'string') {
    return new GatewayError(status, fallbackCode(status))
  }

  return new GatewayError(status, envelope.code, readFieldErrors(envelope.errors))
}

/** Lit la réponse et en tire l'erreur. La réponse est consommée. */
export async function toGatewayError(response: Response): Promise<GatewayError> {
  const envelope = await response.json().catch(() => undefined)
  return gatewayErrorFromEnvelope(response.status, envelope)
}

/**
 * Ne retient que `field` et `message`. Recopier l'objet tel quel laisserait passer les clés que le
 * contrat ne décrit pas — exactement le chemin par lequel une donnée sensible s'échappe.
 */
function readFieldErrors(errors: unknown): readonly GatewayFieldError[] {
  if (!Array.isArray(errors)) return []

  return errors.flatMap((entry) =>
    isRecord(entry) && typeof entry.field === 'string' && typeof entry.message === 'string'
      ? [{ field: entry.field, message: entry.message }]
      : [],
  )
}

function fallbackCode(status: number): string {
  if (status >= 500) return GATEWAY_TRANSPORT_CODES.upstream
  return GATEWAY_TRANSPORT_CODES.unexpected
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
