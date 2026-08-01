/**
 * `StatusPill` — la règle la plus stricte du système visuel.
 *
 * La charte §06 : `link_status` se rend en **point coloré + libellé mono**, `breaker_state` en
 * **pilule teintée**. Jamais l'inverse, jamais fusionnés, et jamais dérivés l'un de l'autre — parce
 * qu'« un disjoncteur ouvert sur un lien vivant (attendre la reprise) et un bind mort (rebind
 * manuel) demandent des actions opposées ».
 *
 * Le test central de ce fichier est le dernier : **`closed` appartient à deux vocabulaires du
 * contrat**, et une version antérieure devinait la dimension à partir de la valeur. Elle peignait
 * donc un client résilié en pilule verte « circuit sain ». C'est la devinette qu'on vérifie disparue.
 */

import { describe, expect, it } from 'vitest'
import { renderComponent } from '~/test/render'
import { StatusPill } from './status-pill'

describe('StatusPill — link_status', () => {
  it('rend un point et le libellé de l’API, en snake_case', () => {
    // « Les pilules de statut conservent le snake_case de l'API » — c'est ce qu'un opérateur grep.
    const { getByText, container } = renderComponent(
      <StatusPill kind="link" state="reconnecting" />,
    )

    expect(getByText('reconnecting')).toBeInTheDocument()
    expect(container.querySelector('.ui-status__dot')).toBeInTheDocument()
  })

  it('donne la bonne tonalité à chacun des trois états du contrat', () => {
    const cases = [
      { state: 'up', tone: 'up' },
      { state: 'reconnecting', tone: 'degraded' },
      { state: 'down', tone: 'down' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = renderComponent(<StatusPill kind="link" state={state} />)
      expect(container.querySelector(`.ui-status--${tone}`)).not.toBeNull()
      unmount()
    }
  })

  it('n’anime le point que sur une valeur en direct', () => {
    // « Une seule animation en boucle dans tout le système » : le pouls de 1,8 s du point vivant.
    // Le poser sur un instantané ferait mentir le seul signal de fraîcheur du produit.
    const snapshot = renderComponent(<StatusPill kind="link" state="up" />)
    expect(snapshot.container.querySelector('.ui-status--live')).toBeNull()
    snapshot.unmount()

    const live = renderComponent(<StatusPill kind="link" state="up" live />)
    expect(live.container.querySelector('.ui-status--live')).not.toBeNull()
  })

  it('n’est une région live que lorsqu’elle est réellement en direct', () => {
    // **Le piège du lecteur d'écran.** Un `role="status"` par défaut ferait de chaque pilule une
    // région live : un tableau de 50 connecteurs à deux dimensions en compterait cent, et la
    // première salve WebSocket les annoncerait toutes. Inutilisable au moment de l'incident.
    const snapshot = renderComponent(<StatusPill kind="link" state="down" />)
    expect(snapshot.queryByRole('status')).toBeNull()
    snapshot.unmount()

    const live = renderComponent(<StatusPill kind="link" state="down" live />)
    expect(live.getByRole('status')).toHaveTextContent('down')
  })

  it('affiche la métadonnée quand elle est fournie', () => {
    const { getByText } = renderComponent(<StatusPill kind="link" state="up" meta="~2 s" />)

    expect(getByText('~2 s')).toBeInTheDocument()
  })
})

describe('StatusPill — breaker_state', () => {
  it('rend une pilule teintée, jamais un point', () => {
    const { container, getByText } = renderComponent(
      <StatusPill kind="breaker" state="half_open" />,
    )

    expect(getByText('half_open')).toBeInTheDocument()
    expect(container.querySelector('.ui-breaker--half_open')).not.toBeNull()
    // **Le cœur de la règle** : le disjoncteur n'emprunte jamais le rendu du lien.
    expect(container.querySelector('.ui-status__dot')).toBeNull()
  })

  it('couvre les trois états du disjoncteur', () => {
    for (const state of ['closed', 'open', 'half_open'] as const) {
      const { container, unmount } = renderComponent(<StatusPill kind="breaker" state={state} />)
      expect(container.querySelector(`.ui-breaker--${state}`)).not.toBeNull()
      unmount()
    }
  })

  it('n’est jamais une région live — un disjoncteur n’est pas alimenté par la WS', () => {
    const { queryByRole } = renderComponent(<StatusPill kind="breaker" state="open" />)

    expect(queryByRole('status')).toBeNull()
  })
})

/**
 * La collision que le typage referme.
 *
 * `closed` est un `BreakerState` **et** un statut de client / compte SMPP. Deviner la dimension à
 * partir de la valeur — ce que faisait la version précédente — rendait donc un client résilié comme
 * un disjoncteur sain.
 */
describe('StatusPill — la dimension est déclarée, jamais devinée', () => {
  it('rend `closed` en pilule quand c’est un disjoncteur', () => {
    const { container } = renderComponent(<StatusPill kind="breaker" state="closed" />)

    expect(container.querySelector('.ui-breaker--closed')).not.toBeNull()
  })

  it('rend `closed` en point au repos quand c’est un client résilié', () => {
    const { container, getByText } = renderComponent(<StatusPill kind="entity" state="closed" />)

    // Ni pilule de disjoncteur, ni rouge de panne : une fin de vie administrative n'appelle aucune
    // intervention, et la peindre en alerte enverrait chercher une panne qui n'existe pas.
    expect(container.querySelector('.ui-breaker')).toBeNull()
    expect(container.querySelector('.ui-status--idle')).not.toBeNull()
    expect(getByText('closed')).toBeInTheDocument()
  })

  it('distingue un compte suspendu d’un lien tombé', () => {
    const entity = renderComponent(<StatusPill kind="entity" state="suspended" />)
    expect(entity.container.querySelector('.ui-status--down')).not.toBeNull()
    entity.unmount()

    const link = renderComponent(<StatusPill kind="link" state="down" />)
    expect(link.container.querySelector('.ui-status--down')).not.toBeNull()
  })

  it('couvre exactement l’énumération `CdrStatus` du contrat', () => {
    const cases = [
      { state: 'delivered', tone: 'up' },
      { state: 'enroute', tone: 'degraded' },
      { state: 'rerouted', tone: 'degraded' },
      { state: 'expired', tone: 'degraded' },
      { state: 'failed', tone: 'down' },
      // `rejected` est un échec : il doit se voir dans la colonne, pas se fondre dans le gris.
      { state: 'rejected', tone: 'down' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = renderComponent(<StatusPill kind="delivery" state={state} />)
      expect(container.querySelector(`.ui-status--${tone}`)).not.toBeNull()
      unmount()
    }
  })
})
