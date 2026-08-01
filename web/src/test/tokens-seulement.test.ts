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

/**
 * Les couleurs nommées qu'on écrit sans y penser. La liste CSS en compte 148 ; celles-ci sont les
 * seules qu'un développeur tape spontanément, et l'ancrage sur une propriété de couleur évite de
 * signaler le mot « or » ou « tan » dans une phrase française.
 */
const NAMED_COLOURS =
  'white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|gold|cyan|magenta|teal|navy|olive|lime|maroon|aqua|fuchsia|tomato|crimson|salmon|coral|indigo|violet|beige|ivory|khaki|plum|orchid|tan|wheat'

const COLOUR_PATTERN = new RegExp(
  [
    // Notations numériques : `#hex`, et les fonctions de couleur de CSS Color 4.
    String.raw`#[0-9a-fA-F]{3,8}\b`,
    String.raw`\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(`,
    // Couleur nommée, mais seulement en valeur d'une propriété de couleur : `color: red`,
    // `background: white`, `border: 1px solid tomato`.
    String.raw`(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline|fill|stroke|box-shadow|column-rule)\s*:[^;]*\b(${NAMED_COLOURS})\b`,
  ].join('|'),
)

describe('couleurs en dur', () => {
  const files = [
    ...sourceFilesIn(join(SRC, 'components'), ['.tsx', '.ts', '.css']),
    // **`src/routes/` compte aussi** : c'est là que vivront les ~30 écrans, et là qu'un
    // `style={{ color: '#e5484d' }}` en ligne passerait sans bruit. L'omettre laissait la garde
    // surveiller la bibliothèque et pas ses appelants.
    ...sourceFilesIn(join(SRC, 'routes'), ['.tsx', '.ts', '.css']),
    ...sourceFilesIn(join(SRC, 'lib'), ['.tsx', '.ts', '.css']),
    ...sourceFilesIn(join(SRC, 'styles'), ['.css']).filter(
      (file) => !file.startsWith(TOKEN_DIRECTORY),
    ),
  ].filter(
    (file) =>
      !file.endsWith('.test.tsx') &&
      !file.endsWith('.test.ts') &&
      // La feuille de la page de référence **décrit** la charte : elle a le droit de nommer une
      // couleur pour la montrer. Le reste de `src/routes/` ne l'a pas.
      !file.endsWith('design-reference.css') &&
      !file.endsWith('routeTree.gen.ts'),
  )

  it('a des fichiers à surveiller, sinon ce test ne garde rien', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('aucun composant ni feuille de style ne désigne une couleur en dur', () => {
    const offenders = files.flatMap((file) => {
      const lines = readFileSync(file, 'utf8').split('\n')

      return lines.flatMap((line, index) =>
        COLOUR_PATTERN.test(stripTokenReferences(stripComment(line)))
          ? [`${relative(SRC, file)}:${index + 1} → ${line.trim()}`]
          : [],
      )
    })

    expect(offenders).toEqual([])
  })

  it('se prouve lui-même — y compris sur les formes qui lui échappaient', () => {
    // Sans ces cas, un motif cassé rendrait l'assertion précédente verte à jamais. Les six premiers
    // passaient tous la première version de la garde.
    const shouldCatch = [
      'color: #2dd4bf;',
      'background: rgba(0, 0, 0, .5);',
      'color: red;',
      'background: white;',
      'border: 1px solid tomato;',
      'background: color-mix(in srgb, white 14%, transparent);',
      'color: oklab(50% 0.1 0.1);',
      'color: lch(50% 40 60);',
    ]

    for (const line of shouldCatch) {
      expect(COLOUR_PATTERN.test(line), line).toBe(true)
    }

    const shouldPass = [
      'color: TOKEN;',
      // Une dimension n'est pas une couleur : la garde ne déborde pas sur la géométrie.
      'width: 16px;',
      // Du texte français qui contient un mot de couleur, hors propriété.
      "const message = 'Le disjoncteur est ouvert, le lien reste vert'",
      'gap: TOKEN;',
    ]

    for (const line of shouldPass) {
      expect(COLOUR_PATTERN.test(line), line).toBe(false)
    }
  })

  it('ne signale pas une référence de token dont le nom contient une couleur', () => {
    // `var(--tint-teal)` est la bonne écriture. Sans dépouillement, la règle des couleurs nommées
    // signalait exactement les lignes conformes — et une garde qui punit le bon usage se fait
    // retirer dans la semaine.
    for (const line of [
      'background: var(--tint-teal);',
      'color: var(--violet-500);',
      'border-color: var(--tint-green);',
    ]) {
      expect(COLOUR_PATTERN.test(stripTokenReferences(line)), line).toBe(false)
    }

    // Mais une vraie couleur nommée à côté d'un token reste vue.
    expect(
      COLOUR_PATTERN.test(stripTokenReferences('border: 1px solid tomato; color: var(--a);')),
    ).toBe(true)

    // Et surtout : la **valeur de repli** d'un token n'est pas une exemption.
    expect(COLOUR_PATTERN.test(stripTokenReferences('color: var(--absent, #ff0000);'))).toBe(true)
    expect(
      COLOUR_PATTERN.test(stripTokenReferences('background: var(--absent, rgb(255, 0, 0));')),
    ).toBe(true)
  })

  it('ne tronque plus une ligne à la première multiplication', () => {
    // Le désarmement le plus facile de l'ancienne version : `*` précédée d'un espace coupait la
    // ligne, et tout ce qui suivait — la couleur comprise — disparaissait de l'analyse.
    const line = "style={{ width: n * 2, background: '#ff0000' }}"

    expect(stripComment(line)).toContain('#ff0000')
    expect(COLOUR_PATTERN.test(stripComment(line))).toBe(true)
  })

  it('retire quand même les vrais commentaires', () => {
    expect(stripComment('  * Le teal de la charte est #2dd4bf.').trim()).toBe('')
    expect(stripComment('const x = 1 // #2dd4bf').trim()).toBe('const x = 1')
    expect(stripComment('color: var(--a); /* #2dd4bf */').trim()).toBe('color: var(--a);')
  })
})

/**
 * Retire les références de token avant l'analyse.
 *
 * `var(--tint-teal)` **est** la bonne façon d'écrire une couleur, mais le nom du token contient le
 * mot « teal » : sans ce dépouillement, la règle des couleurs nommées signalait précisément les
 * lignes conformes. Une garde qui punit le bon usage se fait retirer dans la semaine.
 */
function stripTokenReferences(line: string): string {
  // **Seulement le nom, jamais le repli.** Dépouiller `var(--x, #ff0000)` en entier laissait passer
  // une couleur en dur sous une forme CSS parfaitement idiomatique — le correctif rouvrait la porte
  // qu'il venait de fermer. Le repli reste donc dans la ligne analysée.
  return line.replaceAll(/var\(\s*--[a-z0-9-]+/g, 'var(TOKEN')
}

/**
 * Retire les commentaires d'une ligne — sans avaler le code qui les précède.
 *
 * La première version coupait à **toute astérisque précédée d'un espace**. Une multiplication
 * suffisait à la désarmer : `style={{ width: n * 2, background: '#ff0000' }}` devenait
 * `style={{ width: n` avant analyse, et la couleur disparaissait. Le désarmement ne demandait
 * aucune mauvaise foi — juste du code normal.
 *
 * L'astérisque n'est donc reconnue comme marqueur qu'en **début de ligne**, la forme d'un bloc
 * `/** … *\/` continué.
 */
function stripComment(line: string): string {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '')
    .replace(/(^|\s)\/\/.*$/, '')
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
