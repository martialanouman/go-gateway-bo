import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusPill } from './status-pill'

/**
 * La règle la plus stricte du système visuel.
 *
 * `link_status` se rend en **point coloré + libellé mono**, `breaker_state` en **pilule teintée**.
 * Jamais l'inverse, jamais fusionnés, jamais dérivés l'un de l'autre — parce qu'« un disjoncteur
 * ouvert sur un lien vivant (attendre la reprise) et un bind mort (rebind manuel) demandent des
 * actions opposées ».
 *
 * Le test central est le dernier bloc : **`closed` appartient à deux vocabulaires du contrat**. Une
 * version antérieure devinait la dimension à partir de la valeur, et peignait donc un client
 * résilié en pilule verte « circuit sain ». C'est cette devinette qu'on vérifie absente.
 */
describe('StatusPill — link_status', () => {
  it('rend un point et le libellé de l’API, en snake_case', () => {
    // C'est ce qu'un opérateur grep dans les logs : le traduire couperait le lien entre l'écran et
    // la trace.
    const { container } = render(<StatusPill kind="link" state="reconnecting" />)

    expect(screen.getByText('reconnecting')).toBeInTheDocument()
    expect(container.querySelector('.ui-status__dot')).not.toBeNull()
  })

  it('donne sa tonalité à chacun des trois états du contrat', () => {
    const cases = [
      { state: 'up', tone: 'up' },
      { state: 'reconnecting', tone: 'degraded' },
      { state: 'down', tone: 'down' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = render(<StatusPill kind="link" state={state} />)
      expect(container.querySelector(`.ui-status--${tone}`)).not.toBeNull()
      unmount()
    }
  })

  it('n’anime le point que sur une valeur en direct', () => {
    // La seule animation en boucle du système : le pouls de 1,8 s. Le poser sur un instantané
    // ferait mentir le seul signal de fraîcheur du produit.
    const snapshot = render(<StatusPill kind="link" state="up" />)
    expect(snapshot.container.querySelector('.ui-dot--live')).toBeNull()
    snapshot.unmount()

    const live = render(<StatusPill kind="link" state="up" live />)
    expect(live.container.querySelector('.ui-dot--live')).not.toBeNull()
  })

  it('n’est une région live que lorsqu’elle est réellement en direct', () => {
    // Un `role="status"` par défaut ferait de chaque pilule une région live : un tableau de 50
    // connecteurs à deux dimensions en compterait cent, et la première salve WebSocket les
    // annoncerait toutes. Le lecteur d'écran deviendrait inutilisable au moment de l'incident.
    const snapshot = render(<StatusPill kind="link" state="down" />)
    expect(snapshot.queryByRole('status')).toBeNull()
    snapshot.unmount()

    const live = render(<StatusPill kind="link" state="down" live />)
    expect(live.getByRole('status')).toHaveTextContent('down')
  })

  it('affiche la métadonnée quand elle est fournie', () => {
    render(<StatusPill kind="link" state="up" meta="3/4 binds" />)

    expect(screen.getByText('3/4 binds')).toBeInTheDocument()
  })
})

describe('StatusPill — breaker_state', () => {
  it('rend une pilule teintée, jamais un point', () => {
    const { container } = render(<StatusPill kind="breaker" state="half_open" />)

    expect(screen.getByText('half_open')).toBeInTheDocument()
    expect(container.querySelector('.ui-breaker--half_open')).not.toBeNull()
    // **Le cœur de la règle** : le disjoncteur n'emprunte jamais le rendu du lien.
    expect(container.querySelector('.ui-status__dot')).toBeNull()
  })

  it('couvre les trois états du disjoncteur', () => {
    for (const state of ['closed', 'open', 'half_open'] as const) {
      const { container, unmount } = render(<StatusPill kind="breaker" state={state} />)
      expect(container.querySelector(`.ui-breaker--${state}`)).not.toBeNull()
      unmount()
    }
  })

  it('n’est jamais une région live — un disjoncteur n’est pas alimenté par la WebSocket', () => {
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
describe('StatusPill — la dimension est déclarée, jamais devinée', () => {
  it('rend `closed` en pilule quand c’est un disjoncteur', () => {
    const { container } = render(<StatusPill kind="breaker" state="closed" />)

    expect(container.querySelector('.ui-breaker--closed')).not.toBeNull()
  })

  it('rend `closed` en point au repos quand c’est un client résilié', () => {
    const { container } = render(<StatusPill kind="entity" state="closed" />)

    // Ni pilule de disjoncteur, ni rouge de panne : une fin de vie administrative n'appelle aucune
    // intervention, et la peindre en alerte enverrait chercher une panne qui n'existe pas.
    expect(container.querySelector('.ui-breaker')).toBeNull()
    expect(container.querySelector('.ui-status--idle')).not.toBeNull()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('distingue un compte suspendu d’un lien tombé', () => {
    const entity = render(<StatusPill kind="entity" state="suspended" />)
    expect(entity.container.querySelector('.ui-status--down')).not.toBeNull()
    entity.unmount()

    const link = render(<StatusPill kind="link" state="down" />)
    expect(link.container.querySelector('.ui-status--down')).not.toBeNull()
  })

  it('couvre les huit valeurs de `CdrStatus`, sans en laisser tomber au gris', () => {
    // **Le mode d'échec est daté.** La v1.0 en portait six sur huit : une valeur omise retombe sur
    // le repli au repos et disparaît de l'œil de l'opérateur qui balaie la colonne à la recherche
    // des rouges. `web/test/statuts-du-contrat.test.ts` garde l'exhaustivité contre le YAML ; ce
    // test-ci garde la tonalité de chacune.
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
      expect(container.querySelector(`.ui-status--${tone}`), `${state}`).not.toBeNull()
      unmount()
    }
  })
})
