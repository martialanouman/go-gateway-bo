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

/**
 * Nom d'un champ refusé par la validation. Le contrat associe aussi un `message` à chaque champ ;
 * il n'est **pas** conservé — voir le point 1 du docstring. Le nom du champ suffit à surligner le
 * bon contrôle dans un formulaire, et la copie française vient de l'interface, pas du serveur.
 */
export type GatewayFieldError = {
  readonly field: string
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
  /**
   * Le BFF n'a pas pu obtenir son jeton machine. À distinguer d'un refus portant sur la requête de
   * l'opérateur : « le tableau de bord ne sait pas s'authentifier » et « cette action vous est
   * refusée » n'appellent ni la même copie, ni la même réaction.
   */
  authentication: 'gateway_authentication_failed',
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
 * Ne retient que le **nom** du champ. Le `message` associé est du texte libre écrit par la
 * passerelle, et un message de validation cite volontiers la valeur qu'il refuse : « la valeur
 * '…' dépasse 160 caractères » sur un champ de contenu recopierait le corps d'un message dans une
 * propriété énumérable de l'erreur, donc dans le premier log qui l'inspecte. Recopier l'objet tel
 * quel serait pire encore : il passerait aussi les clés que le contrat ne décrit pas.
 */
function readFieldErrors(errors: unknown): readonly GatewayFieldError[] {
  if (!Array.isArray(errors)) return []

  return errors.flatMap((entry) =>
    isRecord(entry) && typeof entry.field === 'string' ? [{ field: entry.field }] : [],
  )
}

function fallbackCode(status: number): string {
  if (status >= 500) return GATEWAY_TRANSPORT_CODES.upstream
  return GATEWAY_TRANSPORT_CODES.unexpected
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
