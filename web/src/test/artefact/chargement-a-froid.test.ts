import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Ces assertions portent sur **l'artefact**, jamais sur la source. Vite réécrit
 * `index.html` — il y injecte le bundle et la feuille de styles — et c'est le
 * fichier réécrit qui atteint le navigateur. Le premier jet de ce test lisait
 * `web/index.html`, où l'invariant tient par construction puisqu'il n'y a ni
 * script ni feuille : il est resté vert pendant que l'artefact faisait attendre
 * le squelette derrière 31 ko de CSS bloquant.
 */
const artefact = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dist/index.html')

/** Les commentaires HTML survivent au build : sans ça, encadrer le squelette
 *  dans `<!-- -->` laisserait toutes les assertions vertes. */
const document = () => readFileSync(artefact, 'utf8').replace(/<!--[\s\S]*?-->/g, '')

describe("l'artefact servi au chargement à froid", () => {
  it('porte la silhouette des trois zones de la coquille', () => {
    const html = document()

    // `<div[^>]+` et non `data-squelette` nu : les sélecteurs du `<style>`
    // portent le même texte.
    expect(html).toMatch(/<div[^>]+data-squelette="rail"/)
    expect(html).toMatch(/<div[^>]+data-squelette="barre"/)
    expect(html).toMatch(/<div[^>]+data-squelette="contenu"/)
  })

  it("garde l'identifiant sur lequel le retrait s'appuie", () => {
    // Sans `id="squelette"`, la règle CSS ne s'applique plus **et**
    // `getElementById('squelette')?.remove()` devient un no-op silencieux.
    expect(document()).toMatch(/<div[^>]+id="squelette"/)
    expect(document()).toMatch(/<div[^>]+id="root"/)
  })

  it('ne laisse aucune feuille de styles bloquer le premier paint', () => {
    const html = document()

    const feuilles = html.match(/<link[^>]+rel="stylesheet"[^>]*>/g) ?? []
    expect(feuilles.length).toBeGreaterThan(0)

    for (const feuille of feuilles) {
      expect(feuille, 'une feuille sans media="print" bloque le paint du squelette').toMatch(
        /media="print"/,
      )
    }
  })

  it('peint réellement le squelette plutôt que de le déclarer', () => {
    const style = document().match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''

    // Ces quatre propriétés sont celles qui font exister la silhouette. Les
    // asserter sur le texte du CSS est faible — jsdom ne fait pas de mise en
    // page — mais c'est ce qui attrape les mutations réelles : `display: none`,
    // `min-height: 0`, un rail de largeur nulle, un fond blanc. La preuve
    // visuelle est le parcours de step-007, contre le binaire.
    expect(style).toMatch(/#squelette\s*\{[^}]*display:\s*grid/)
    expect(style).toMatch(/#squelette\s*\{[^}]*min-height:\s*100vh/)
    expect(style).toMatch(/grid-template-columns:\s*2\d\dpx/)
    expect(style).not.toMatch(/#squelette\s*\{[^}]*background:\s*#(fff|ffffff|white)/i)
  })
})
