import { describe, expect, it } from 'vitest'
import { ATTRIBUT_DIFFEREE, promouvoirFeuillesDifferees } from './feuilles-differees'

function documentAvec(html: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head>${html}</head><body></body></html>`,
    'text/html',
  )
}

describe('la promotion des feuilles différées', () => {
  it('rend applicable une feuille chargée en media="print"', () => {
    const racine = documentAvec(
      `<link rel="stylesheet" href="/a.css" media="print" ${ATTRIBUT_DIFFEREE}>`,
    )

    expect(promouvoirFeuillesDifferees(racine)).toBe(1)
    expect(racine.querySelector('link')?.media).toBe('all')
  })

  it('ne touche pas une feuille qui ne porte pas la marque', () => {
    const racine = documentAvec('<link rel="stylesheet" href="/a.css" media="print">')

    expect(promouvoirFeuillesDifferees(racine)).toBe(0)
    expect(racine.querySelector('link')?.media).toBe('print')
  })

  it("ne fait rien quand il n'y a aucune feuille — le cas du développement", () => {
    expect(promouvoirFeuillesDifferees(documentAvec(''))).toBe(0)
  })
})
