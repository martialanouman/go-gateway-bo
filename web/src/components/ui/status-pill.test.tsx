import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BREAKER_STATES, DELIVERY_TONES, ENTITY_TONES, LINK_TONES, StatusPill } from './status-pill'

/**
 * La règle la plus stricte du système visuel.
 *
 * `link_status` se rend en **point coloré + libellé mono**, `breaker_state` en **pilule teintée**.
 * Jamais l'inverse, jamais fusionnés, jamais dérivés l'un de l'autre — parce qu'« un disjoncteur
 * ouvert sur un lien vivant (attendre la reprise) et un bind mort (rebind manuel) demandent des
 * actions opposées ».
 *
 * Le test central est le dernier bloc : **`closed` appartient à deux vocabulaires du contrat**.
 * Déduire la dimension de la valeur peindrait un client résilié en pilule verte « circuit sain » ;
 * c'est cette devinette qu'on vérifie absente.
 */
describe('StatusPill — link_status', () => {
  it('renders a dot and the API label, in snake_case', () => {
    // C'est ce qu'un opérateur grep dans les logs : le traduire couperait le lien entre l'écran et
    // la trace.
    const { container } = render(<StatusPill kind="link" state="reconnecting" />)

    expect(screen.getByText('reconnecting')).toBeInTheDocument()
    expect(container.querySelector('.ui-status__dot')).not.toBeNull()
  })

  it('gives each of the three contract states its tone', () => {
    const cases = [
      { state: 'up', tone: 'up' },
      { state: 'reconnecting', tone: 'degraded' },
      { state: 'down', tone: 'down' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = render(<StatusPill kind="link" state={state} />)
      expect(container.querySelector(`.ui-dot--${tone}`)).not.toBeNull()
      unmount()
    }
  })

  it('animates the dot only for a live value', () => {
    // Le pouls de 1,8 s est la seule animation en boucle qui porte un **état** : le spinner d'un
    // bouton et le scintillement du squelette tournent aussi, mais ils disent qu'on attend, pas ce
    // qui est vrai. Le poser sur un instantané ferait mentir le seul signal de fraîcheur du produit.
    //
    // *(Cette ligne écrivait « la seule animation en boucle du système », corrigé ailleurs et pas
    // ici : trois porteurs, deux relus. Aucune porte ne lit un commentaire — le seul recours est de
    // parcourir la famille entière, pas les deux premiers.)*
    const snapshot = render(<StatusPill kind="link" state="up" />)
    expect(snapshot.container.querySelector('.ui-dot')).not.toHaveClass('ui-dot--live')
    snapshot.unmount()

    const live = render(<StatusPill kind="link" state="up" live />)
    expect(live.container.querySelector('.ui-dot')).toHaveClass('ui-dot--live')
  })

  it('is a live region only when it is actually live', () => {
    // Un `role="status"` par défaut ferait de chaque pilule une région live : un tableau de 50
    // connecteurs à deux dimensions en compterait cent, et la première salve WebSocket les
    // annoncerait toutes. Le lecteur d'écran deviendrait inutilisable au moment de l'incident.
    const snapshot = render(<StatusPill kind="link" state="down" />)
    expect(snapshot.queryByRole('status')).toBeNull()
    snapshot.unmount()

    const live = render(<StatusPill kind="link" state="down" live />)
    expect(live.getByRole('status')).toHaveTextContent('down')
  })

  it('displays the metadata when provided', () => {
    render(<StatusPill kind="link" state="up" meta="3/4 binds" />)

    expect(screen.getByText('3/4 binds')).toBeInTheDocument()
  })
})

describe('StatusPill — breaker_state', () => {
  it('renders a tinted pill, never a dot', () => {
    const { container } = render(<StatusPill kind="breaker" state="half_open" />)

    expect(screen.getByText('half_open')).toBeInTheDocument()
    expect(container.querySelector('.ui-breaker--half_open')).not.toBeNull()
    // **Le cœur de la règle** : le disjoncteur n'emprunte jamais le rendu du lien.
    expect(container.querySelector('.ui-status__dot')).toBeNull()
  })

  it('covers the three circuit breaker states', () => {
    for (const state of ['closed', 'open', 'half_open'] as const) {
      const { container, unmount } = render(<StatusPill kind="breaker" state={state} />)
      expect(container.querySelector(`.ui-breaker--${state}`)).not.toBeNull()
      unmount()
    }
  })

  it('is never a live region — a circuit breaker is not fed by the WebSocket', () => {
    render(<StatusPill kind="breaker" state="open" />)

    expect(screen.queryByRole('status')).toBeNull()
  })
})

/**
 * La collision que le typage referme.
 *
 * `closed` est un `BreakerState` **et** un statut de client ou de compte SMPP. Deviner la dimension
 * à partir de la valeur rendait donc un client résilié comme un disjoncteur sain.
 */
describe('StatusPill — the dimension is declared, never guessed', () => {
  it('renders `closed` as a pill for a circuit breaker', () => {
    const { container } = render(<StatusPill kind="breaker" state="closed" />)

    expect(container.querySelector('.ui-breaker--closed')).not.toBeNull()
  })

  it('renders `closed` as an idle dot for a terminated client', () => {
    const { container } = render(<StatusPill kind="entity" state="closed" />)

    // Ni pilule de disjoncteur, ni rouge de panne : une fin de vie administrative n'appelle aucune
    // intervention, et la peindre en alerte enverrait chercher une panne qui n'existe pas.
    expect(container.querySelector('.ui-breaker')).toBeNull()
    expect(container.querySelector('.ui-dot--idle')).not.toBeNull()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('lets no value live in two dimensions at once', () => {
    // `closed` appartient à deux vocabulaires, et c'est la seule collision que le contrat porte
    // aujourd'hui. Ce test rougit le jour où une valeur en rejoint une autre dimension : la fusion
    // des tables, que la docstring déclare avoir rejetée, redeviendrait alors possible en silence.
    const dimensions = [
      { nom: 'link', valeurs: Object.keys(LINK_TONES) },
      { nom: 'entity', valeurs: Object.keys(ENTITY_TONES) },
      { nom: 'delivery', valeurs: Object.keys(DELIVERY_TONES) },
      { nom: 'breaker', valeurs: [...BREAKER_STATES] },
    ]

    const collisions = dimensions.flatMap(({ nom, valeurs }) =>
      dimensions
        .filter((autre) => autre.nom !== nom)
        .flatMap((autre) => valeurs.filter((valeur) => autre.valeurs.includes(valeur)))
        .map((valeur) => `${valeur} (${nom})`),
    )

    // `closed` est la collision connue, et la raison d'être de `kind` : elle est attendue, les
    // autres ne le sont pas.
    expect(collisions.sort()).toEqual(['closed (breaker)', 'closed (entity)'])
  })

  it('covers the eight `CdrStatus` values, without letting any fall back to gray', () => {
    // Une valeur omise retombe sur le repli au repos et disparaît de l'œil de l'opérateur qui balaie
    // la colonne à la recherche des rouges. `web/test/contract-statuses.test.ts` garde
    // l'exhaustivité contre le YAML ; ce test-ci garde la tonalité de chacune.
    const cases = [
      { state: 'delivered', tone: 'up' },
      { state: 'accepted', tone: 'degraded' },
      { state: 'enroute', tone: 'degraded' },
      { state: 'rerouted', tone: 'degraded' },
      { state: 'expired', tone: 'degraded' },
      { state: 'failed', tone: 'down' },
      // `rejected` est un échec, pas une attente : il doit se voir au même titre qu'un `failed`.
      { state: 'rejected', tone: 'down' },
      // `cancelled` est une fin administrative, comme un client résilié : rien à réparer.
      { state: 'cancelled', tone: 'idle' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = render(<StatusPill kind="delivery" state={state} />)
      expect(container.querySelector(`.ui-dot--${tone}`), `${state}`).not.toBeNull()
      unmount()
    }
  })
})
