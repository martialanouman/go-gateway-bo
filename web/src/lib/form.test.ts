import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { LoginRequest, MfaVerification } from './contract.gen'
import { refusalInFrench } from './form'

/** Le message que le schéma oppose à cette valeur, ou `undefined` s'il l'accepte. */
function refusalOf(schema: z.ZodType, value: unknown) {
  const outcome = schema.safeParse(value, { error: refusalInFrench })

  return outcome.success ? undefined : outcome.error.issues[0]?.message
}

describe('les bornes du contrat, rendues à l’opérateur', () => {
  it('refuse un mot de passe plus long que ce que le serveur accepte, et nomme la borne', () => {
    // 4 096 est la borne du contrat, et elle n'est écrite nulle part dans ce test : le message la
    // porte parce que le schéma **engendré** la porte. Réécrite ici, l'assertion survivrait à sa
    // disparition du contrat.
    const refusal = refusalOf(LoginRequest.shape.password, 'x'.repeat(4097))

    expect(refusal).toContain('4096')
    expect(refusal).toMatch(/trop longue/)
  })

  it('accepte ce qui tient exactement dans la borne', () => {
    expect(refusalOf(LoginRequest.shape.password, 'x'.repeat(4096))).toBeUndefined()
  })

  it('refuse un challenge plus court que ce que le serveur attend, et nomme la borne', () => {
    const refusal = refusalOf(MfaVerification.shape.challenge, 'trop court')

    expect(refusal).toContain('43')
    expect(refusal).toMatch(/trop courte/)
  })
})

describe('les refus que Zod rédige', () => {
  it('parle français d’un champ absent', () => {
    expect(refusalOf(z.string(), undefined)).toBe('Renseignez ce champ.')
  })

  it('parle français d’une valeur hors de la liste attendue', () => {
    expect(refusalOf(MfaVerification.shape.method, 'carte à puce')).toMatch(/liste attendue/)
  })

  // Le filet, et il n'est pas décoratif : ce qui n'est pas traduit sort **en anglais** de Zod, dans
  // un produit dont toute la copie est en français. Le cas est atteint ici par une règle qu'aucun
  // écran n'emploie encore — il n'y a donc pas de branche morte, seulement une branche qu'aucun
  // écran ne traverse aujourd'hui.
  it('ne laisse aucun message anglais traverser', () => {
    const refusal = refusalOf(
      z.string().refine(() => false),
      'peu importe',
    )

    expect(refusal).toBe('Cette valeur n’est pas acceptée.')
  })
})
