// @vitest-environment node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Sans rendu serveur, le document envoyé au navigateur est le même pour toutes
 * les URL. S'il ne porte rien, coller une URL profonde ouvre sur un `<body>`
 * vide — un sixième moment que le contrat à cinq états du §1.9 n'a pas.
 *
 * Ce test lit la **source** d'`index.html`. La preuve complète est le parcours
 * de step-007, qui charge le binaire JavaScript désactivé ; ici on tient le
 * contrat du document, et `make build` vérifie que le squelette survit au build.
 */
const web = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const document = () => readFileSync(join(web, 'index.html'), 'utf8')

describe('le document servi au chargement à froid', () => {
  it('porte la silhouette des trois zones de la coquille', () => {
    const html = document()

    // `<div[^>]+` et non `data-squelette` nu : les sélecteurs du `<style>`
    // portent le même texte, et une assertion nue restait verte alors que le
    // balisage avait entièrement disparu. La mutation l'a montré.
    expect(html).toMatch(/<div[^>]+data-squelette="rail"/)
    expect(html).toMatch(/<div[^>]+data-squelette="barre"/)
    expect(html).toMatch(/<div[^>]+data-squelette="contenu"/)
  })

  it('peint le squelette avant de charger le bundle', () => {
    const html = document()

    const squelette = html.search(/<div[^>]+data-squelette=/)
    const bundle = html.search(/<script[^>]+type="module"/)

    expect(squelette).toBeGreaterThan(-1)
    expect(bundle).toBeGreaterThan(-1)
    expect(squelette).toBeLessThan(bundle)
  })

  it("habille le squelette sans dépendre d'une feuille de style externe", () => {
    const html = document()

    // Un `<link rel=stylesheet>` bloque le premier paint : le squelette
    // n'apparaîtrait qu'après un aller-retour réseau, ce qui le vide de son sens.
    expect(html).toMatch(/<style>/)

    const styleInline = html.indexOf('<style>')
    const feuilleExterne = html.search(/<link[^>]+rel="stylesheet"/)
    if (feuilleExterne > -1) {
      expect(styleInline).toBeLessThan(feuilleExterne)
    }
  })

  it('laisse au routeur un point de montage distinct du squelette', () => {
    const html = document()

    // Monter React **dans** le squelette le ferait disparaître par effet de
    // bord au premier rendu ; le retirer explicitement est la responsabilité de
    // l'entrée client, pas celle de React.
    expect(html).toMatch(/id="root"/)
  })
})
