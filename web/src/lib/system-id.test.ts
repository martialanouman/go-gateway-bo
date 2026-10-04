import { describe, expect, it } from 'vitest'
import { generatedSystemId } from './system-id'

describe('a generated system_id', () => {
  it('starts with the account name, folded to what an SMPP bind accepts', () => {
    expect(generatedSystemId('Orange CI Prod')).toMatch(/^orangeci-[a-z0-9]{6}$/)
  })

  it('folds accents rather than dropping the letter', () => {
    expect(generatedSystemId('Société Générale')).toMatch(/^societeg-[a-z0-9]{6}$/)
  })

  it('never exceeds the 15 characters of the SMPP field', () => {
    for (const name of ['a', 'BICICI', 'un nom de compte très long', '9']) {
      expect(generatedSystemId(name).length).toBeLessThanOrEqual(15)
    }
  })

  it('falls back to twelve random characters when the name gives nothing', () => {
    expect(generatedSystemId('---- ')).toMatch(/^[a-z0-9]{12}$/)
  })

  it('draws a new suffix each time', () => {
    const drawn = new Set(Array.from({ length: 20 }, () => generatedSystemId('BICICI')))
    expect(drawn.size).toBe(20)
  })
})
