/**
 * `StatusPill` — la règle la plus stricte du système visuel.
 *
 * La charte §06 : `link_status` se rend en **point coloré + libellé mono**, `breaker_state` en
 * **pilule teintée**. Jamais l'inverse, jamais fusionnés, et jamais dérivés l'un de l'autre — parce
 * qu'« un disjoncteur ouvert sur un lien vivant (attendre la reprise) et un bind mort (rebind
 * manuel) demandent des actions opposées ».
 *
 * Deux dimensions, deux rendus : un opérateur qui les confond prend la mauvaise décision, et c'est
 * exactement ce que ce composant existe pour empêcher.
 */

import { describe, expect, it } from 'vitest'
import { renderComponent } from '~/test/render'
import { StatusPill } from './status-pill'

describe('StatusPill — link_status', () => {
  it('rend un point et le libellé de l’API, en snake_case', () => {
    // « Les pilules de statut conservent le snake_case de l'API, parce que c'est ce que dit le
    // payload » — et c'est ce qu'un opérateur grep dans les logs.
    const { getByText, container } = renderComponent(<StatusPill state="reconnecting" />)

    expect(getByText('reconnecting')).toBeInTheDocument()
    expect(container.querySelector('.ui-status__dot')).toBeInTheDocument()
  })

  it('donne la bonne tonalité à chaque état de la charte', () => {
    const cases = [
      { state: 'up', tone: 'up' },
      { state: 'delivered', tone: 'up' },
      { state: 'reconnecting', tone: 'degraded' },
      { state: 'expired', tone: 'degraded' },
      { state: 'down', tone: 'down' },
      { state: 'suspended', tone: 'down' },
      { state: 'unbound', tone: 'idle' },
    ] as const

    for (const { state, tone } of cases) {
      const { container, unmount } = renderComponent(<StatusPill state={state} />)
      expect(container.querySelector(`.ui-status--${tone}`)).not.toBeNull()
      unmount()
    }
  })

  it('annonce l’état aux technologies d’assistance, pas seulement par la couleur', () => {
    // Une couleur seule ne passe pas AA : le libellé mono porte déjà le sens, encore faut-il que
    // l'ensemble soit lisible comme un statut et non comme un mot isolé.
    const { getByRole } = renderComponent(<StatusPill state="down" />)

    expect(getByRole('status')).toHaveTextContent('down')
  })

  it('n’anime le point que sur une valeur en direct', () => {
    // « Une seule animation en boucle dans tout le système » : le pouls de 1,8 s du point vivant.
    // Le poser sur un instantané ferait mentir le seul signal de fraîcheur du produit.
    const snapshot = renderComponent(<StatusPill state="up" />)
    expect(snapshot.container.querySelector('.ui-status--live')).toBeNull()
    snapshot.unmount()

    const live = renderComponent(<StatusPill state="up" live />)
    expect(live.container.querySelector('.ui-status--live')).not.toBeNull()
  })
})

describe('StatusPill — breaker_state', () => {
  it('rend une pilule teintée, jamais un point', () => {
    const { container, getByText } = renderComponent(<StatusPill state="half_open" />)

    expect(getByText('half_open')).toBeInTheDocument()
    expect(container.querySelector('.ui-breaker--half_open')).not.toBeNull()
    // **Le cœur de la règle** : le disjoncteur n'emprunte jamais le rendu du lien.
    expect(container.querySelector('.ui-status__dot')).toBeNull()
  })

  it('couvre les trois états du disjoncteur', () => {
    for (const state of ['closed', 'open', 'half_open'] as const) {
      const { container, unmount } = renderComponent(<StatusPill state={state} />)
      expect(container.querySelector(`.ui-breaker--${state}`)).not.toBeNull()
      unmount()
    }
  })

  it('ne dérive pas une dimension de l’autre', () => {
    // `open` est un état de disjoncteur ; il ne doit surtout pas se rendre comme un lien dégradé.
    const { container } = renderComponent(<StatusPill state="open" />)

    expect(container.querySelector('.ui-status')).toBeNull()
  })
})
