/**
 * La règle de garde, prise seule.
 *
 * Elle est testée ici et pas seulement à travers les routes, parce qu'elle est **le** point où les
 * deux applications — le `beforeLoad` de la coquille et son composant — se rejoignent. Un trou dans
 * cette fonction est un trou dans les deux à la fois.
 */

import { describe, expect, it } from 'vitest'
import { sessionRedirect } from './session-gate'

const OPERATOR = {
  id: 'op-1',
  email: 'operatrice@example.test',
  displayName: 'Opératrice',
  permissions: [],
  mfaCompleted: true,
} as const

describe('sessionRedirect', () => {
  it('ne renvoie nulle part tant que la session n’est pas connue', () => {
    // **Le cas qui compte le plus.** Rediriger pendant l'attente sortirait de la console un
    // opérateur parfaitement légitime, à chaque rechargement de page.
    expect(sessionRedirect(undefined)).toBeUndefined()
  })

  it('renvoie un anonyme au login', () => {
    expect(sessionRedirect(null)).toBe('/connexion')
  })

  it('renvoie une session partielle au second facteur', () => {
    expect(sessionRedirect({ ...OPERATOR, mfaCompleted: false })).toBe('/connexion/verification')
  })

  it('laisse passer une session complète', () => {
    expect(sessionRedirect(OPERATOR)).toBeUndefined()
  })
})
