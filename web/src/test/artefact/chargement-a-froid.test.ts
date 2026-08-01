import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ATTRIBUT_DIFFEREE } from '../../lib/feuilles-differees'

/**
 * Ces assertions portent sur **l'artefact**, jamais sur la source. Vite réécrit
 * `index.html` — il y injecte le bundle et la feuille de styles — et c'est le
 * fichier réécrit qui atteint le navigateur. Le premier jet de ce test lisait
 * `web/index.html`, où l'invariant tient par construction puisqu'il n'y a ni
 * script ni feuille : il est resté vert pendant que l'artefact faisait attendre
 * le squelette derrière 31 ko de CSS bloquant.
 */
const artefact = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../internal/webassets/dist/index.html',
)

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
      // Sans la marque, `promouvoirFeuillesDifferees` ne la trouve pas et la
      // feuille reste en `print` pour toujours : console non stylée.
      expect(feuille, "une feuille reportée sans marque n'est jamais promue").toContain(
        ATTRIBUT_DIFFEREE,
      )
    }
  })

  it("embarque la promotion de la feuille dans le bundle d'entrée", () => {
    // Le contrat était refermé sur le **nom** de l'attribut (constante partagée)
    // mais pas sur l'**appel** : supprimer `promouvoirFeuillesDifferees(document)`
    // de `main.tsx` laissait toutes les portes vertes et livrait une console
    // dont l'unique feuille restait en `media="print"` — entièrement non stylée.
    // `main.tsx` n'est chargé par aucun test et sort de la couverture ; c'est
    // l'artefact qui doit en témoigner.
    const html = document()
    const entree = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
    if (!entree) {
      throw new Error("aucun bundle d'entrée dans l'artefact")
    }

    const bundle = readFileSync(join(dirname(artefact), entree), 'utf8')

    expect(
      bundle,
      'le bundle ne promeut pas la feuille : la console resterait non stylée',
    ).toContain(ATTRIBUT_DIFFEREE)
  })

  it('place le squelette avant le point de montage', () => {
    const html = document()

    // L'ancienne assertion d'ordre portait sur le bundle ; Vite hisse le script
    // dans le `<head>`, elle ne pouvait pas être portée telle quelle. Celle-ci
    // dit ce qui compte : React se monte **sous** le squelette, donc hors écran
    // tant que le squelette occupe 100vh.
    expect(html.indexOf('id="squelette"')).toBeLessThan(html.indexOf('id="root"'))
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
