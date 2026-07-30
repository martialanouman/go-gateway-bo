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
    // qu'une seule fois ». Une version refusait le mot et rejetait donc la bonne copie.
    for (const text of [
      'L’ancien secret cesse d’être accepté dans 24 heures.',
      'Le nouveau secret ne sera affiché qu’une seule fois.',
      'Mot de passe modifié.',
    ]) {
      expect(() => assertToastText('description', text), text).not.toThrow()
    }
  })

  it('laisse passer les identifiants que le contrat émet', () => {
    // **Le défaut le plus grave de la version précédente.** Elle refusait toute suite de seize
    // caractères sans espace : un UUID en fait trente-six, et le contrat en déclare 125. Le premier
    // écran qui aurait annoncé une suspension par identifiant aurait levé en plein clic, sur une
    // copie conforme à CLAUDE.md — qui exige justement l'identifiant verbatim.
    for (const text of [
      'Client 550e8400-e29b-41d4-a716-446655440000 suspendu',
      'Message msg_01J9K2A7QF8ZC3T4V5W6X7Y8Z renvoyé',
      'Export cdr_2026-07-30_orange.csv prêt',
      'Renvoi vers 2250701020304 effectué',
    ]) {
      expect(() => assertToastText('title', text), text).not.toThrow()
    }
  })

  it('refuse un contenu cité — le vrai signal', () => {
    // Un toast annonce un fait, il ne rapporte jamais ce qu'un message contenait. La phrase que ce
    // module existe pour empêcher se reconnaît à ses guillemets, pas à la forme de ce qu'ils
    // entourent.
    for (const text of [
      'Le message « RDV demain 14h chez le docteur » a été renvoyé',
      'Contenu "RDV demain 14h" transmis',
    ]) {
      expect(() => assertToastText('description', text), text).toThrow(/invariants a et b/)
    }
  })

  it('ne reproduit jamais la citation dans l’erreur', () => {
    // Le message d'erreur part au log : y recopier le contenu le publierait.
    const text = 'Le message « RDV demain 14h chez le docteur » a été renvoyé'

    expect(() => assertToastText('description', text)).toThrow(/guillemets/)
    expect(() => assertToastText('description', text)).not.toThrow(/RDV demain/)
  })

  it('refuse un texte plus long qu’un SMS n’est court', () => {
    // 120, **sous** les 160 d'un SMS GSM-7. Une borne à 200 — celle de la version précédente —
    // laissait passer un corps de message entier, alors que le commentaire affirmait l'inverse.
    const long = 'Le connecteur a été mis à jour. '.repeat(5)
    expect(long.length).toBeGreaterThan(120)
    expect(() => assertToastText('description', long)).toThrow(/120/)
  })

  it('nomme le champ fautif', () => {
    const quoted = 'Contenu « RDV demain » transmis'

    expect(() => assertToastText('title', quoted)).toThrow(/title/)
    expect(() => assertToastText('description', quoted)).toThrow(/description/)
  })
})
