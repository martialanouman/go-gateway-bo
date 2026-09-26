import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { LoginRequest, MfaVerification } from './contract.gen'
import { refusalInFrench } from './form'

/** Le message que le schéma oppose à cette valeur, ou `undefined` s'il l'accepte. */
function refusalOf(schema: z.ZodType, value: unknown) {
  const outcome = schema.safeParse(value, { error: refusalInFrench })

  return outcome.success ? undefined : outcome.error.issues[0]?.message
}

describe('the contract bounds, rendered to the operator', () => {
  it('refuses a password longer than what the server accepts, and names the bound', () => {
    // 4 096 est la borne du contrat, et elle n'est écrite nulle part dans ce test : le message la
    // porte parce que le schéma **engendré** la porte. Réécrite ici, l'assertion survivrait à sa
    // disparition du contrat.
    const refusal = refusalOf(LoginRequest.shape.password, 'x'.repeat(4097))

    expect(refusal).toContain('4096')
    expect(refusal).toMatch(/trop longue/)
  })

  it('accepts what fits exactly within the bound', () => {
    expect(refusalOf(LoginRequest.shape.password, 'x'.repeat(4096))).toBeUndefined()
  })

  it('refuses a challenge shorter than what the server expects, and names the bound', () => {
    const refusal = refusalOf(MfaVerification.shape.challenge, 'trop court')

    expect(refusal).toContain('43')
    expect(refusal).toMatch(/trop courte/)
  })
})

describe('the refusals that Zod writes', () => {
  it('speaks French about a missing field', () => {
    expect(refusalOf(z.string(), undefined)).toBe('Renseignez ce champ.')
  })

  it('speaks French about a value outside the expected list', () => {
    expect(refusalOf(MfaVerification.shape.method, 'carte à puce')).toMatch(/liste attendue/)
  })

  // Le filet, et il n'est pas décoratif : ce qui n'est pas traduit sort **en anglais** de Zod, dans
  // un produit dont toute la copie est en français. Le cas est atteint ici par une règle qu'aucun
  // écran n'emploie encore — il n'y a donc pas de branche morte, seulement une branche qu'aucun
  // écran ne traverse aujourd'hui.
  it('lets no English message through', () => {
    const refusal = refusalOf(
      z.string().refine(() => false),
      'peu importe',
    )

    expect(refusal).toBe('Cette valeur n’est pas acceptée.')
  })
})

describe('number agreement in the refusal', () => {
  it('writes « 1 caractère » in the singular, not « 1 caractères »', () => {
    // La borne vient du refus : elle vaut 1 pour tout champ dont le contrat exige seulement qu'il ne
    // soit pas vide — `password` et `code` en portent un chacun. Le pluriel fautif est donc le cas
    // courant, pas le cas rare.
    expect(refusalOf(z.string().min(1), '')).toContain('1 caractère au minimum')
    expect(refusalOf(z.string().min(1), '')).not.toContain('caractères')
  })

  it('uses the plural beyond one', () => {
    expect(refusalOf(MfaVerification.shape.challenge, 'court')).toContain('43 caractères')
  })
})
