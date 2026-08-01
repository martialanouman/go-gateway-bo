/**
 * La règle de garde, prise seule.
 *
 * Elle est testée ici et pas seulement à travers les routes, parce qu'elle est **le** point où les
 * deux applications — le `beforeLoad` de la coquille et son composant — se rejoignent. Un trou dans
 * cette fonction est un trou dans les deux à la fois.
 */

import { describe, expect, it } from 'vitest'
import { sessionRedirect, sessionStatus } from './session-gate'

const OPERATOR = {
  id: 'op-1',
  email: 'operatrice@example.test',
  displayName: 'Opératrice',
  permissions: [],
  mfaCompleted: true,
} as const

describe('sessionStatus', () => {
  it('distingue « on attend » de « on ne saura pas »', () => {
    // **Le cœur du module.** Une requête en erreur porte `data: undefined`, exactement comme une
    // requête en cours. Les confondre a produit deux défauts symétriques : la coquille restait vide
    // indéfiniment, et l'écran de vérification renvoyait au login — d'où un va-et-vient entre les
    // deux à chaque hoquet du serveur, chaque tour consommant une tentative du compteur.
    expect(sessionStatus({ data: undefined, isError: false })).toBe('unknown')
    expect(sessionStatus({ data: undefined, isError: true })).toBe('unavailable')
  })

  it('garde une session connue quand un rafraîchissement échoue', () => {
    // Une requête qui échoue **après** avoir réussi reste en erreur tout en conservant sa réponse.
    // Regarder l'erreur en premier expulsait l'opérateur, ou peignait une panne par-dessus une
    // console qui marchait, au premier rafraîchissement raté.
    expect(sessionStatus({ data: OPERATOR, isError: true })).toBe('complete')
  })

  it('ne croit plus un `null` en cache quand le serveur est injoignable', () => {
    // **L'autre moitié, et elle a coûté une boucle entière.** Ce `null` est celui que la garde écrit
    // en renvoyant au login ; après un mot de passe accepté, il est périmé. Le lire comme « anonyme »
    // ramenait au formulaire qu'on venait de remplir, à chaque tentative, tant que le serveur
    // tombait. Un opérateur en cache est une observation positive ; un `null`, non.
    expect(sessionStatus({ data: null, isError: true })).toBe('unavailable')
    expect(sessionStatus({ data: null, isError: false })).toBe('anonymous')
  })

  it('lit les trois états de session', () => {
    expect(sessionStatus({ data: null, isError: false })).toBe('anonymous')
    expect(sessionStatus({ data: { ...OPERATOR, mfaCompleted: false }, isError: false })).toBe(
      'partial',
    )
    expect(sessionStatus({ data: OPERATOR, isError: false })).toBe('complete')
  })
})

describe('sessionRedirect', () => {
  it('ne renvoie nulle part tant que la session n’est pas connue', () => {
    // Rediriger pendant l'attente sortirait de la console un opérateur légitime, à chaque
    // rechargement de page.
    expect(sessionRedirect('unknown')).toBeUndefined()
  })

  it('ne déconnecte personne sur une panne', () => {
    // Un 502 passager ne vaut pas une expulsion : l'écran doit se dégrader, pas naviguer.
    expect(sessionRedirect('unavailable')).toBeUndefined()
  })

  it('renvoie un anonyme au login', () => {
    expect(sessionRedirect('anonymous')).toBe('/connexion')
  })

  it('renvoie une session partielle au second facteur', () => {
    expect(sessionRedirect('partial')).toBe('/connexion/verification')
  })

  it('laisse passer une session complète', () => {
    expect(sessionRedirect('complete')).toBeUndefined()
  })
})
