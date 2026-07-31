// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy } from './password-policy'
import { generateTemporaryPassword } from './temporary-password'

describe('le mot de passe initial d’un compte créé', () => {
  it('passe la politique du produit', () => {
    // Sans quoi le compte serait créé avec un mot de passe que l'écran de changement refuserait
    // ensuite — et personne ne le découvrirait avant le premier opérateur bloqué.
    expect(checkPasswordPolicy(generateTemporaryPassword())).toBeUndefined()
  })

  it('n’emploie aucun caractère qui se confonde à la lecture', () => {
    // Il se dicte au téléphone. `O`/`0` et `I`/`l`/`1` coûteraient des appels au support, puis un
    // contournement — « je te crée un compte avec un mot de passe simple ».
    const drawn = Array.from({ length: 200 }, () => generateTemporaryPassword()).join('')

    expect(drawn).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/)
  })

  it('ne rend jamais deux fois la même valeur', () => {
    const drawn = new Set(Array.from({ length: 100 }, () => generateTemporaryPassword()))

    // Une source d'aléa cassée — un générateur figé, une graine constante — donnerait le même mot
    // de passe à tous les comptes créés, et rien d'autre ne le dirait.
    expect(drawn.size).toBe(100)
  })
})
