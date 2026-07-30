// @vitest-environment node

/**
 * « Aucun composant ne code une couleur en dur : uniquement des tokens » (step-041).
 *
 * ## Pourquoi c'est un test et pas une consigne
 *
 * Parce qu'une couleur écrite en dur ne casse rien. Elle s'affiche, elle a l'air juste, et elle ne
 * se découvre qu'au premier ajustement de la charte — quand la moitié des écrans suit la nouvelle
 * valeur et l'autre non. Le défaut est invisible au moment où il est introduit et coûteux au moment
 * où il se voit : exactement le profil qu'une énumération attrape et qu'une revue laisse passer.
 *
 * ## Ce qui est cherché
 *
 * Les formes qui **désignent une couleur** : hexadécimal, `rgb()`, `hsl()`, `oklch()`. Pas les
 * dimensions — un `width: 16px` sur une case à cocher est une géométrie, pas une décision de charte,
 * et la charte ne tokenise pas les tailles d'indicateur.
 */

import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Les tokens **déclarent** les couleurs de la charte : c'est le seul endroit qui a le droit. */
const TOKEN_DIRECTORY = join(SRC, 'styles', 'tokens')

const COLOUR_PATTERN = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/

describe('couleurs en dur', () => {
  const files = [
    ...sourceFilesIn(join(SRC, 'components'), ['.tsx', '.ts', '.css']),
    ...sourceFilesIn(join(SRC, 'styles'), ['.css']).filter(
      (file) => !file.startsWith(TOKEN_DIRECTORY),
    ),
  ].filter((file) => !file.endsWith('.test.tsx') && !file.endsWith('.test.ts'))

  it('a des fichiers à surveiller, sinon ce test ne garde rien', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('aucun composant ni feuille de style ne désigne une couleur en dur', () => {
    const offenders = files.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')

      return lines.flatMap((line, index) =>
        COLOUR_PATTERN.test(stripComment(line))
          ? [`${relative(SRC, file)}:${index + 1} → ${line.trim()}`]
          : [],
      )
    })

    expect(offenders).toEqual([])
  })

  it('se prouve lui-même sur une ligne fabriquée', () => {
    // Sans ce cas, un motif cassé rendrait l'assertion précédente verte à jamais.
    expect(COLOUR_PATTERN.test('color: #2dd4bf;')).toBe(true)
    expect(COLOUR_PATTERN.test('background: rgba(0, 0, 0, .5);')).toBe(true)
    expect(COLOUR_PATTERN.test('color: var(--text-primary);')).toBe(false)
    // Une dimension n'est pas une couleur : la garde ne doit pas déborder sur la géométrie.
    expect(COLOUR_PATTERN.test('width: 16px;')).toBe(false)
  })
})

/** Un commentaire peut citer un hexadécimal de la charte pour expliquer ; ce n'est pas du style. */
function stripComment(line: string): string {
  return line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)(\/\/|\*).*$/, '')
}

function sourceFilesIn(directory: string, extensions: readonly string[]): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesIn(path, extensions)
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : []
  })
}
