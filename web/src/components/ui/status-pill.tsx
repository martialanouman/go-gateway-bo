import { Dot } from './icon'

/**
 * Les statuts de la charte, et l'interdiction de confondre leurs dimensions.
 *
 * **`kind` est obligatoire** parce que `closed` appartient à deux vocabulaires du contrat —
 * `BreakerState: [closed, open, half_open]` et `status: [active, suspended, closed]` de `Customer` et
 * `SmppAccount`. Déduire la dimension de la valeur peindrait donc un `<StatusPill
 * state={customer.status} />` — le geste le plus naturel du monde — en **pilule verte « circuit
 * sain » pour un client résilié**. Seule la déclaration de la dimension l'empêche, et l'union
 * discriminée en fait une propriété du compilateur.
 *
 * **Deux rendus, jamais mélangés.** `breaker_state` est une pilule teintée, tout le reste un point
 * coloré + libellé mono. La raison est opérationnelle : un disjoncteur ouvert sur un lien vivant
 * (attendre la reprise) et un bind mort (rebind manuel) demandent des actions opposées.
 *
 * **Le libellé reste en `snake_case`** : ce sont les valeurs du contrat, qu'un opérateur grep dans
 * les logs. Les traduire couperait le lien entre l'écran et la trace.
 *
 * Les quatre énumérations sont tenues égales au contrat par `test/statuts-du-contrat.test.ts`.
 */

import type { DotTone } from './icon'

/** `openapi-admin.yaml` — `BreakerState`. */
export type BreakerState = 'closed' | 'open' | 'half_open'

/** `openapi-admin.yaml` — `LinkStatus`. La seule dimension alimentée par la WebSocket. */
export type LinkStatus = 'up' | 'reconnecting' | 'down'

/** `openapi-admin.yaml` — `Customer.status`, `SmppAccount.status`. */
export type EntityStatus = 'active' | 'suspended' | 'closed'

/** `openapi-admin.yaml` — `CdrStatus`. */
export type DeliveryStatus =
  | 'accepted'
  | 'enroute'
  | 'delivered'
  | 'failed'
  | 'expired'
  | 'rejected'
  | 'rerouted'
  | 'cancelled'

/** Les tonalités, **par dimension** : une table unique se heurterait à la collision sur `closed`. */
export const LINK_TONES: Readonly<Record<LinkStatus, DotTone>> = {
  up: 'up',
  reconnecting: 'degraded',
  down: 'down',
}

export const ENTITY_TONES: Readonly<Record<EntityStatus, DotTone>> = {
  active: 'up',
  suspended: 'down',
  // Un client résilié n'est pas une panne : c'est une fin de vie administrative. Le peindre en rouge
  // enverrait chercher une intervention là où il n'y a rien à réparer.
  closed: 'idle',
}

export const DELIVERY_TONES: Readonly<Record<DeliveryStatus, DotTone>> = {
  delivered: 'up',
  // Pris en charge, pas encore conclu — le même moment qu'`enroute`, donc la même tonalité.
  accepted: 'degraded',
  enroute: 'degraded',
  rerouted: 'degraded',
  expired: 'degraded',
  failed: 'down',
  // `rejected` est un échec, pas une attente : il doit se voir dans la colonne au même titre qu'un
  // `failed`.
  rejected: 'down',
  // Annulé avant remise : une fin administrative, comme un client résilié. Rien à réparer.
  cancelled: 'idle',
}

export const BREAKER_STATES: readonly BreakerState[] = ['closed', 'open', 'half_open']

type CommonProps = {
  /** Libellé de remplacement. Reste en `snake_case` — voir l'en-tête. */
  readonly label?: string
  /** Métadonnée mono à droite du libellé : durée, compteur, horodatage. */
  readonly meta?: string
  readonly className?: string
}

export type StatusPillProps =
  /** `breaker_state` — **pilule teintée**, et la seule dimension rendue ainsi. */
  | (CommonProps & { readonly kind: 'breaker'; readonly state: BreakerState })
  /**
   * `link_status` — point + libellé. `live` n'existe que sur cette dimension : c'est la seule que la
   * WebSocket alimente, et le pouls est le seul signal de fraîcheur du produit.
   */
  | (CommonProps & { readonly kind: 'link'; readonly state: LinkStatus; readonly live?: boolean })
  | (CommonProps & { readonly kind: 'entity'; readonly state: EntityStatus })
  | (CommonProps & { readonly kind: 'delivery'; readonly state: DeliveryStatus })

export function StatusPill(props: StatusPillProps) {
  const { kind, state, label, meta, className } = props

  if (kind === 'breaker') {
    return (
      <span className={['ui-breaker', `ui-breaker--${state}`, className].filter(Boolean).join(' ')}>
        {label ?? state}
      </span>
    )
  }

  const tone =
    kind === 'link'
      ? LINK_TONES[state]
      : kind === 'entity'
        ? ENTITY_TONES[state]
        : DELIVERY_TONES[state]

  const live = kind === 'link' && props.live === true

  return (
    <span
      // Pas de `ui-status--${tone}` ici : la tonalité est peinte par `.ui-dot--${tone}`, et une
      // seconde classe que rien ne cible serait une classe morte sur chaque ligne de chaque tableau.
      // Les tests de tonalité visent donc le point, qui peint, plutôt qu'une étiquette décorative.
      className={['ui-status', className].filter(Boolean).join(' ')}
      // `role="status"` **seulement** sur une valeur en direct, et jamais par défaut. Un `role`
      // inconditionnel ferait de chaque pilule une région live : un tableau de 50 connecteurs à deux
      // dimensions en compterait cent, et la première salve WebSocket les annoncerait toutes, en
      // file d'attente polie et sans contexte.
      role={live ? 'status' : undefined}
    >
      <Dot tone={tone} live={live} className="ui-status__dot" />
      <span className="ui-status__label">{label ?? state}</span>
      {meta === undefined ? null : <span className="ui-status__meta">{meta}</span>}
    </span>
  )
}
