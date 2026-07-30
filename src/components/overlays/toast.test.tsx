// @vitest-environment node

/**
 * Le toast, et l'invariant (a) posé là où il est le plus menacé.
 *
 * C'est le composant le plus exposé du produit : il apparaît après une action, il est souvent
 * construit à partir de la réponse de la passerelle, il reste quelques secondes, et il finit dans la
 * capture d'écran qu'on colle dans un ticket. « Le message "RDV demain 14h" a été renvoyé » est
 * exactement la phrase qu'un développeur pressé écrira.
 *
 * La garde est donc **à l'entrée**, pas à l'affichage : un refus tardif laisserait le toast paraître.
 */

import { describe, expect, it } from 'vitest'
import { assertToastText } from './toast'

describe('assertToastText', () => {
  it('laisse passer un toast qui annonce un fait', () => {
    expect(() => assertToastText('title', 'Identifiant renouvelé')).not.toThrow()
    expect(() =>
      assertToastText('description', 'L’ancien secret cesse d’être accepté dans 24 heures.'),
    ).not.toThrow()
  })

  it('laisse passer une copie qui **parle** d’un secret', () => {
    // Le mot est légitime en français, et la charte l'emploie : « le nouveau secret ne sera affiché
    // qu'une seule fois ». Une première version refusait le mot et rejetait donc la bonne copie —
    // exactement le profil de garde qui se fait retirer dans la semaine.
    for (const text of [
      'L’ancien secret cesse d’être accepté dans 24 heures.',
      'Le nouveau secret ne sera affiché qu’une seule fois.',
      'Mot de passe modifié.',
    ]) {
      expect(() => assertToastText('description', text), text).not.toThrow()
    }
  })

  it('refuse une **valeur** qui a la forme d’un secret', () => {
    for (const text of [
      'Nouveau secret : sk-live-0123456789abcdef',
      'Identifiant de bind : YWJjZGVmZ2hpamtsbW5vcA==',
      'Clé émise : 4f3c2b1a9e8d7c6b5a4f3e2d',
    ]) {
      expect(() => assertToastText('title', text), text).toThrow(/invariants a et b/)
    }
  })

  it('ne recopie jamais la valeur refusée dans l’erreur', () => {
    // Le message d'erreur part au log : y citer le secret le publierait, ce qui est exactement la
    // fuite que la garde existe pour empêcher.
    const text = 'Nouveau secret : sk-live-0123456789'

    expect(() => assertToastText('title', text)).toThrow(/suite opaque/)
    expect(() => assertToastText('title', text)).not.toThrow(/sk-live-0123456789/)
  })

  it('refuse un texte trop long pour être une notification', () => {
    // Au-delà, ce n'est plus un fait annoncé mais un contenu — et un corps de SMS y tiendrait
    // largement. Un toast dit ce qui a eu lieu, pas ce que cela contenait.
    // Du texte avec des espaces : `'x'.repeat(201)` serait attrapé par la garde de forme avant
    // celle de longueur, et le test n'aurait vérifié que la première.
    const long = 'Le connecteur a été mis à jour. '.repeat(8)
    expect(long.length).toBeGreaterThan(200)
    expect(() => assertToastText('description', long)).toThrow(/200/)
  })

  it('nomme le champ fautif', () => {
    const value = 'sk-live-0123456789abcdef'

    expect(() => assertToastText('title', value)).toThrow(/title/)
    expect(() => assertToastText('description', value)).toThrow(/description/)
  })
})
