// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy, explainRejection, MIN_PASSWORD_LENGTH } from './password-policy'

describe('politique de mot de passe', () => {
  it('accepte une phrase de passe ordinaire', () => {
    expect(checkPasswordPolicy('le chat dort sur le toit')).toBeUndefined()
  })

  it('refuse en dessous de la longueur minimale', () => {
    expect(checkPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toEqual({
      reason: 'too_short',
      minLength: MIN_PASSWORD_LENGTH,
    })
    expect(checkPasswordPolicy('a'.repeat(MIN_PASSWORD_LENGTH))).toBeUndefined()
  })

  it('refuse un mot de passe notoirement compromis, quelle que soit sa casse', () => {
    expect(checkPasswordPolicy('azerty123456')?.reason).toBe('compromised')
    expect(checkPasswordPolicy('AZERTY123456')?.reason).toBe('compromised')
    expect(checkPasswordPolicy('  Motdepasse123  ')?.reason).toBe('compromised')
  })

  it('refuse un mot de passe qui contient l identité de son propriétaire', () => {
    // Dans un outil interne, l'annuaire est connu de tous : `operateur2026!` est deviné du premier
    // coup par n'importe quel collègue.
    expect(
      checkPasswordPolicy('operateur2026!!', ['operateur@example.test', 'Opératrice Réseau'])
        ?.reason,
    ).toBe('contains_identity')
  })

  it('compare les fragments de l identité, pas la chaîne entière', () => {
    // Comparer l'adresse complète ne verrait rien : personne ne met son email entier dans son mot de
    // passe, tout le monde y met son prénom ou la partie avant l'arobase.
    expect(checkPasswordPolicy('MarieDupont2026', ['marie.dupont@example.test'])?.reason).toBe(
      'contains_identity',
    )
  })

  it('ne se déclenche pas sur un fragment trop court', () => {
    // Sans plancher, un identifiant comme `a@b.test` interdirait tout mot de passe contenant « a ».
    expect(checkPasswordPolicy('une phrase de passe correcte', ['a@b.test'])).toBeUndefined()
  })

  it('n impose aucune règle de composition', () => {
    // Les règles « une majuscule, un chiffre, un symbole » ne produisent pas d'entropie, elles
    // produisent `Password1!`. Le NIST recommande explicitement de ne plus les exiger.
    expect(checkPasswordPolicy('tout en minuscules sans chiffre')).toBeUndefined()
  })
})

describe('explication du refus', () => {
  it('dit la conséquence, jamais le mot de passe', () => {
    const secret = 'ZQX7-MOTDEPASSE'

    for (const rejection of [
      { reason: 'too_short', minLength: MIN_PASSWORD_LENGTH },
      { reason: 'compromised' },
      { reason: 'contains_identity' },
    ] as const) {
      const message = explainRejection(rejection)
      expect(message).not.toContain(secret)
      expect(message.length).toBeGreaterThan(30)
      expect(message).toMatch(/refusé/)
    }
  })

  it('nomme la longueur attendue plutôt que de dire « trop court »', () => {
    expect(explainRejection({ reason: 'too_short', minLength: MIN_PASSWORD_LENGTH })).toContain(
      String(MIN_PASSWORD_LENGTH),
    )
  })
})
