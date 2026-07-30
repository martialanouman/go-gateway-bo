/**
 * Les deux dimensions de statut de la charte, et l'interdiction de les confondre.
 *
 * ## Pourquoi un seul composant pour deux rendus
 *
 * Parce que le mode d'échec à empêcher est qu'un écran choisisse le mauvais. La charte §06 est
 * catégorique : `link_status` se rend en **point coloré + libellé mono**, `breaker_state` en
 * **pilule teintée**, « jamais fusionnés et jamais dérivés l'un de l'autre ». La raison est
 * opérationnelle, pas esthétique :
 *
 * > Un disjoncteur ouvert sur un lien vivant (attendre la reprise) et un bind mort (rebind manuel)
 * > demandent des actions opposées.
 *
 * Un composant unique qui **reconnaît** l'état et choisit lui-même le rendu retire à l'appelant
 * l'occasion de se tromper. C'est la raison d'être du `BREAKER_STATES` ci-dessous : la bascule est
 * une donnée, pas un paramètre que l'écran passerait.
 *
 * ## Le libellé reste en `snake_case`
 *
 * `half_open`, `reconnecting`, `unbound` : ce sont les valeurs du contrat, et un opérateur les grep
 * dans les logs. Les traduire couperait le lien entre l'écran et la trace.
 */

/** Les trois états du disjoncteur. Leur seule présence bascule le rendu en pilule. */
const BREAKER_STATES = ['closed', 'open', 'half_open'] as const

export type BreakerState = (typeof BREAKER_STATES)[number]

/**
 * La tonalité de chaque état de lien, d'après la sémantique de couleur de la charte.
 *
 * Quatre tonalités et pas une de plus : vert « sain », ambre « dégradé », rouge « panne », neutre
 * « au repos ». Un état inconnu retombe sur `idle` — un statut qu'on ne sait pas lire n'est pas une
 * panne, et le peindre en rouge déclencherait une intervention pour rien.
 */
const LINK_TONES: Readonly<Record<string, 'up' | 'degraded' | 'down' | 'idle'>> = {
  up: 'up',
  active: 'up',
  connected: 'up',
  delivered: 'up',
  closed_ok: 'up',
  reconnecting: 'degraded',
  pending: 'degraded',
  throttled: 'degraded',
  expired: 'degraded',
  degraded: 'degraded',
  down: 'down',
  failed: 'down',
  suspended: 'down',
  idle: 'idle',
  unbound: 'idle',
  unknown: 'idle',
}

export type StatusPillProps = {
  /** La valeur du contrat, telle quelle : `up`, `reconnecting`, `half_open`… */
  readonly state: string
  /** Libellé de remplacement. Reste en `snake_case` — voir l'en-tête. */
  readonly label?: string
  /** Métadonnée mono à droite du libellé : durée, compteur, horodatage. */
  readonly meta?: string
  /**
   * Valeur alimentée par la WebSocket. **Réservé aux données en direct** : c'est la seule animation
   * en boucle du système, et la poser sur un instantané ferait mentir le seul signal de fraîcheur
   * dont dispose l'opérateur.
   */
  readonly live?: boolean
  readonly className?: string
}

function isBreakerState(state: string): state is BreakerState {
  return (BREAKER_STATES as readonly string[]).includes(state)
}

export function StatusPill({ state, label, meta, live = false, className }: StatusPillProps) {
  if (isBreakerState(state)) {
    return (
      <span
        role="status"
        className={['ui-breaker', `ui-breaker--${state}`, className].filter(Boolean).join(' ')}
      >
        {label ?? state}
      </span>
    )
  }

  const tone = LINK_TONES[state] ?? 'idle'

  return (
    <span
      role="status"
      className={['ui-status', `ui-status--${tone}`, live ? 'ui-status--live' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="ui-status__dot" aria-hidden="true" />
      <span className="ui-status__label">{label ?? state}</span>
      {meta ? <span className="ui-status__meta">{meta}</span> : null}
    </span>
  )
}
