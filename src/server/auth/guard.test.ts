// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from './cookie'
import { readSessionCookie } from './guard'

describe('lecture du cookie de session', () => {
  it('trouve le cookie parmi plusieurs', () => {
    const header = `theme=sombre; ${SESSION_COOKIE_NAME}=abc.def; langue=fr`

    expect(readSessionCookie(header)).toBe('abc.def')
  })

  it('découpe au premier signe égal, jamais à tous', () => {
    // **La subtilité qui compte.** Une signature base64url ne contient pas de `=`, mais un
    // `split('=')` naïf tronquerait n'importe quelle valeur qui en contiendrait un — et le cookie
    // deviendrait invalide sans que rien n'explique pourquoi.
    const header = `${SESSION_COOKIE_NAME}=abc.def==`

    expect(readSessionCookie(header)).toBe('abc.def==')
  })

  it('tolère les espaces autour des séparateurs', () => {
    expect(readSessionCookie(`  ${SESSION_COOKIE_NAME} = valeur ; autre=x`)).toBe('valeur')
  })

  it('ne confond pas un cookie dont le nom commence pareil', () => {
    // `__Host-gwbo_session_autre` n'est pas notre cookie : le comparer par préfixe laisserait un
    // tiers poser une valeur que nous lirions.
    const header = `${SESSION_COOKIE_NAME}_autre=piege; ${SESSION_COOKIE_NAME}=vrai`

    expect(readSessionCookie(header)).toBe('vrai')
  })

  it('rend undefined quand le cookie est absent, vide ou l en-tête inexistant', () => {
    for (const header of [
      undefined,
      null,
      '',
      'theme=sombre',
      `${SESSION_COOKIE_NAME}=`,
      `${SESSION_COOKIE_NAME}`,
      '=orphelin',
    ]) {
      expect(readSessionCookie(header), JSON.stringify(header)).toBeUndefined()
    }
  })
})
