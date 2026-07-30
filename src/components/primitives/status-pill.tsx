/**
 * Les statuts de la charte, et l'interdiction de confondre leurs dimensions.
 *
 * ## Pourquoi `kind` est obligatoire
 *
 * La première version prenait `state: string` et **devinait** la dimension : si la valeur était
 * `closed`, `open` ou `half_open`, c'était un disjoncteur. Le contrat rend cette devinette fausse —
 * `closed` appartient à deux vocabulaires :
 *
 * ```yaml
 * BreakerState: { enum: [closed, open, half_open] }          # le disjoncteur
 * status:       { enum: [active, suspended, closed] }        # Customer, SmppAccount
 * ```
 *
 * `<StatusPill state={customer.status} />` — le geste le plus naturel du monde — aurait donc peint un
 * **client résilié en pilule verte « circuit sain »**. C'est exactement la confusion que la charte §06
 * interdit, et une devinette ne peut pas la prévenir : seule la déclaration de la dimension le peut.
 *
 * D'où l'union discriminée. Le typage refuse `kind="breaker"` avec `state="suspended"`, et refuse
 * `live` ailleurs que sur un lien. La règle de la charte devient une propriété du compilateur au lieu
 * d'un commentaire.
 *
 * ## Deux rendus, jamais mélangés
 *
 * `breaker_state` est une **pilule teintée**. Tout le reste est un **point coloré + libellé mono**.
 * La raison est opérationnelle : « un disjoncteur ouvert sur un lien vivant (attendre la reprise) et
 * un bind mort (rebind manuel) demandent des actions opposées ».
 *
 * ## Le libellé reste en `snake_case`
 *
 * `half_open`, `reconnecting`, `suspended` : ce sont les valeurs du contrat, et un opérateur les
 * grep dans les logs. Les traduire couperait le lien entre l'écran et la trace.
 */

/** `openapi-admin.yaml` — `BreakerState`. */
export type BreakerState = 'closed' | 'open' | 'half_open'

/** `openapi-admin.yaml` — `LinkStatus`. La seule dimension alimentée par la WebSocket. */
export type LinkStatus = 'up' | 'reconnecting' | 'down'

/** `openapi-admin.yaml` — `Customer.status`, `SmppAccount.status`. */
export type EntityStatus = 'active' | 'suspended' | 'closed'

/**
 * `openapi-admin.yaml` — `CdrStatus`. Recopié depuis l'énumération du contrat, pas inventé : une
 * première version portait `pending` et `throttled`, qui n'y figurent pas, et **omettait `rejected`**
 * — un échec, qui serait donc tombé sur le repli gris « au repos » et aurait disparu de l'œil de
 * l'opérateur qui balaie la colonne à la recherche des rouges.
 */
export type DeliveryStatus =
  | 'enroute'
  | 'delivered'
  | 'failed'
  | 'expired'
  | 'rejected'
  | 'rerouted'

type Tone = 'up' | 'degraded' | 'down' | 'idle'

/**
 * La tonalité par dimension. Séparées, et non fusionnées en une table unique : c'est la fusion qui
 * avait produit la collision sur `closed`.
 */
const LINK_TONES: Readonly<Record<LinkStatus, Tone>> = {
  up: 'up',
  reconnecting: 'degraded',
  down: 'down',
}

const ENTITY_TONES: Readonly<Record<EntityStatus, Tone>> = {
  active: 'up',
  suspended: 'down',
  // Un client résilié n'est pas une panne : c'est une fin de vie administrative. Le peindre en rouge
  // enverrait chercher une intervention là où il n'y a rien à réparer.
  closed: 'idle',
}

const DELIVERY_TONES: Readonly<Record<DeliveryStatus, Tone>> = {
  delivered: 'up',
  enroute: 'degraded',
  rerouted: 'degraded',
  expired: 'degraded',
  failed: 'down',
  // `rejected` est un échec, pas une attente : il doit se voir dans la colonne au même titre qu'un
  // `failed`. C'est exactement la valeur que l'oubli précédent peignait en gris.
  rejected: 'down',
}

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
      className={['ui-status', `ui-status--${tone}`, live ? 'ui-status--live' : '', className]
        .filter(Boolean)
        .join(' ')}
      // `role="status"` **seulement** sur une valeur en direct, et jamais par défaut. Un `role`
      // inconditionnel ferait de chaque pilule une région live : un tableau de 50 connecteurs à deux
      // dimensions en compterait cent, et la première salve WebSocket les annoncerait toutes, en
      // file d'attente polie et sans contexte. Le lecteur d'écran deviendrait inutilisable au moment
      // précis où l'incident arrive.
      role={live ? 'status' : undefined}
    >
      <span className="ui-status__dot" aria-hidden="true" />
      <span className="ui-status__label">{label ?? state}</span>
      {meta ? <span className="ui-status__meta">{meta}</span> : null}
    </span>
  )
}
