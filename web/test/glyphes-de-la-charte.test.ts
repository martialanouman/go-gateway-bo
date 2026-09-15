// @vitest-environment node

/**
 * Le jeu de glyphes porté est-il encore celui de la charte ?
 *
 * **Le mode d'échec est arrivé.** `icon.tsx` promet « le jeu ci-dessous **est** le jeu complet » et
 * le premier portage en comptait 21 là où le kit en dessine 22 : `ellipsis-vertical` avait disparu
 * entre la lecture et l'écriture. Le test qui l'aurait attrapé écrivait « vingt-et-un » — le même
 * nombre, recopié de la même main, au même moment. Deux recopies ne font pas une vérification.
 *
 * Ce fichier lit **le kit**, seule source du jeu. Un glyphe ajouté ou retiré en amont fait rougir,
 * et la promesse de complétude redevient falsifiable.
 *
 * Ce qu'il ne garde pas : le **dessin**. Deux glyphes peuvent porter le même nom et des chemins
 * différents ; seule la planche de `/_design` le montre, et c'est un travail d'œil.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GLYPH_NAMES } from '../src/components/ui/icon'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Le kit de la charte, dans le dépôt. `GLYPHS` s'arrête à `ALIAS` : les alias ne sont pas des
 * glyphes, et le portage a délibérément refusé de les reprendre — ils adouciraient la règle « un nom
 * hors du jeu ne rend rien » en lui trouvant un voisin.
 */
function glyphesDeLaCharte(): string[] {
  const kit = readFileSync(
    resolve(
      here,
      '..',
      '..',
      '.claude',
      'skills',
      'sms-gateway-design',
      'components',
      'core',
      'Icon.jsx',
    ),
    'utf8',
  )

  const debut = kit.indexOf('const GLYPHS = {')
  const fin = kit.indexOf('const ALIAS')
  expect(debut, 'le kit ne déclare plus GLYPHS').toBeGreaterThanOrEqual(0)
  expect(fin, 'le kit ne déclare plus ALIAS : la borne du bloc a bougé').toBeGreaterThan(debut)

  return [...kit.slice(debut, fin).matchAll(/^\s+'?([a-z][a-z-]*)'?:\s*\(\)/gm)]
    .map(([, name]) => name as string)
    .sort()
}

describe('le jeu de glyphes', () => {
  it('sait lire le kit — sans quoi ce fichier serait vert et vide', () => {
    // Le méta-test : si le kit change de forme et que l'extraction ne trouve plus rien, la
    // comparaison ci-dessous deviendrait une égalité de deux listes vides.
    expect(glyphesDeLaCharte().length).toBeGreaterThan(15)
    expect(glyphesDeLaCharte()).toContain('dot')
  })

  it('porte exactement ceux que la charte dessine', () => {
    expect([...GLYPH_NAMES].sort()).toEqual(glyphesDeLaCharte())
  })
})
