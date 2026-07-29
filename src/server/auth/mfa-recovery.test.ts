// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { generateRecoveryCodes, hashRecoveryCode, RECOVERY_CODE_COUNT } from './mfa-recovery'
import { readMfaKeys } from './mfa-secret'

const KEYS = readMfaKeys({ AUTH_MFA_SECRET: 'une-cle-mfa-de-test-suffisamment-longue-pour' })
const OTHER_KEYS = readMfaKeys({ AUTH_MFA_SECRET: 'une-autre-cle-mfa-de-test-tout-aussi-longue' })

describe('génération des codes de récupération', () => {
  const codes = generateRecoveryCodes()

  it('en rend dix, tous différents', () => {
    // Dix, parce qu'un opérateur qui en a consommé quelques-uns doit encore en avoir sous la main
    // sans qu'on lui redemande d'en régénérer — un lot trop court finit par pousser à désactiver le
    // second facteur « le temps de régler le problème ».
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT)
  })

  it("évite les caractères qu'on lit de travers", () => {
    // Ces codes se recopient à la main depuis un papier, souvent sous pression. `O` et `0`, `I`, `L`
    // et `1` se confondent, et une saisie refusée à ce moment-là se lit comme « mon code ne marche
    // pas », pas comme une faute de frappe.
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-TV-Z]{5}-[2-9A-HJ-NP-TV-Z]{5}$/)
    }
  })

  it('ne rend jamais deux fois le même lot', () => {
    expect(generateRecoveryCodes()).not.toEqual(codes)
  })
})

describe('hachage des codes de récupération', () => {
  it('rend le même condensat pour le même code', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK', KEYS)).toBe(hashRecoveryCode('ABCDE-FGHJK', KEYS))
  })

  it('ne laisse pas le code lisible dans son condensat', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK', KEYS)).not.toContain('ABCDE')
  })

  it('accepte la saisie telle que la tape un opérateur', () => {
    // Tirets oubliés, espaces, minuscules : ce sont des variantes de la même chose, et refuser un
    // code juste pour sa mise en forme rendrait la porte de sortie inutilisable au pire moment.
    const reference = hashRecoveryCode('ABCDE-FGHJK', KEYS)

    for (const input of ['abcde-fghjk', 'ABCDEFGHJK', ' ABCDE FGHJK ', 'abcde fghjk']) {
      expect(hashRecoveryCode(input, KEYS)).toBe(reference)
    }
  })

  it('distingue deux codes différents', () => {
    expect(hashRecoveryCode('ABCDE-FGHJK', KEYS)).not.toBe(hashRecoveryCode('ABCDE-FGHJM', KEYS))
  })

  it('dépend du poivre serveur', () => {
    // Sans poivre, un condensat volé en base se retourne par force brute : cinquante bits résistent,
    // mais rien n'oblige à offrir la cible. La clé rend l'attaque impossible sans le fichier
    // d'environnement **en plus** de la base.
    expect(hashRecoveryCode('ABCDE-FGHJK', KEYS)).not.toBe(
      hashRecoveryCode('ABCDE-FGHJK', OTHER_KEYS),
    )
  })
})
