/**
 * Lecture des tokens CSS de la charte pour les tests.
 *
 * Les tokens sont du CSS, pas du TypeScript : c'est délibéré — une feuille de style les consomme
 * sans passer par un build, et le navigateur les résout en cascade. Mais un test ne peut pas les
 * vérifier sans les lire, d'où ce petit lecteur : il extrait les déclarations et résout les `var()`
 * en chaîne, pour qu'une assertion porte sur la couleur réellement rendue et non sur un alias.
 *
 * Volontairement minimal : il ne comprend ni `color-mix()`, ni la cascade, ni les media queries.
 * Ce dont les tests ont besoin, ce sont les valeurs littérales et les alias qui y mènent.
 *
 * Ce fichier vit dans `src/test/` et non à côté des tokens : il lit le système de fichiers, ce qui
 * n'a rien à faire dans `src/styles/`, dont tout le contenu part au navigateur. La règle de lint de
 * l'invariant (d) l'a d'ailleurs refusé — c'est elle qui a tranché l'emplacement.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens')

/** Les fichiers de tokens, dans l'ordre où `app.css` les assemble. */
export const TOKEN_FILES = [
  'fonts.css',
  'colors.css',
  'typography.css',
  'spacing.css',
  'radius.css',
  'elevation.css',
  'motion.css',
  'layout.css',
] as const

/** Toutes les déclarations `--nom: valeur` trouvées dans les fichiers de tokens. */
export function readTokens(): Map<string, string> {
  const tokens = new Map<string, string>()

  for (const file of TOKEN_FILES) {
    // Les commentaires sont retirés avant l'extraction : un commentaire qui citerait une
    // déclaration (« remplace --foo: bar; ») entrerait sinon dans la table comme si elle existait.
    const css = readFileSync(join(TOKENS_DIRECTORY, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name && value) tokens.set(name, value.trim())
    }
  }

  return tokens
}

/**
 * Suit les `var(--x)` jusqu'à la valeur littérale. Rend `undefined` si la chaîne ne mène nulle part,
 * **y compris lorsqu'elle boucle** : un alias circulaire ne doit pas ressortir comme une valeur
 * définie, sinon `toBeDefined()` passerait dessus sans rien voir.
 */
export function resolveToken(tokens: Map<string, string>, name: string): string | undefined {
  const visited = new Set<string>()
  let current = name

  while (!visited.has(current)) {
    visited.add(current)
    const value = tokens.get(current)
    if (value === undefined) return undefined

    const reference = /^var\((--[\w-]+)\)$/.exec(value)
    if (!reference?.[1]) return value
    current = reference[1]
  }

  return undefined
}

/**
 * Résout une couleur en un hexadécimal opaque, en évaluant les `color-mix()` de la charte.
 *
 * Sans cette évaluation, les tests de contraste ne couvriraient que les quatre fonds **littéraux**
 * de la palette — alors que le produit compose : une pilule pose son texte sur sa propre teinte à
 * 14 %, une ligne survolée ou sélectionnée change de fond. Ce sont exactement les endroits où le
 * contraste se perd, et ils resteraient hors de portée du test.
 *
 * `over` est le fond sur lequel la couleur est peinte : `transparent` dans un `color-mix` signifie
 * « laisse voir ce qu'il y a dessous », donc le mélange doit être composé sur ce fond pour donner
 * la couleur réellement perçue.
 */
export function resolveColor(
  tokens: Map<string, string>,
  name: string,
  over = '#000000',
): string | undefined {
  const value = resolveToken(tokens, name)
  if (value === undefined) return undefined
  return evaluateColor(tokens, value, over)
}

function evaluateColor(
  tokens: Map<string, string>,
  value: string,
  over: string,
): string | undefined {
  const literal = /^#[0-9a-f]{6}$/i.exec(value.trim())
  if (literal) return value.trim().toLowerCase()

  // `color-mix(in srgb, <couleur> <p>%, <couleur|transparent>)` — la seule forme que la charte
  // emploie. Toute autre syntaxe rend `undefined` plutôt qu'une approximation silencieuse.
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/i.exec(
    value.trim(),
  )
  if (!mix?.[1] || !mix[2] || !mix[3]) return undefined

  const foreground = evaluateColor(tokens, dereference(tokens, mix[1]), over)
  const proportion = Number(mix[2]) / 100
  const background =
    mix[3].trim().toLowerCase() === 'transparent'
      ? over
      : evaluateColor(tokens, dereference(tokens, mix[3]), over)

  if (!foreground || !background) return undefined
  return blend(foreground, background, proportion)
}

function dereference(tokens: Map<string, string>, value: string): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!reference?.[1]) return value.trim()
  return resolveToken(tokens, reference[1]) ?? value.trim()
}

/** Mélange deux couleurs opaques en sRGB, sans correction gamma — comme le fait `color-mix(in srgb)`. */
function blend(foreground: string, background: string, proportion: number): string {
  const channels = [0, 2, 4].map((offset) => {
    const fg = Number.parseInt(foreground.slice(1 + offset, 3 + offset), 16)
    const bg = Number.parseInt(background.slice(1 + offset, 3 + offset), 16)
    return Math.round(fg * proportion + bg * (1 - proportion))
  })

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Luminance relative, telle que WCAG 2.1 la définit. Les couleurs de la charte sont toutes en
 * hexadécimal sur six chiffres — le seul format que cette fonction accepte, pour qu'une valeur
 * inattendue échoue franchement plutôt que de produire un ratio inventé.
 */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) throw new Error(`Couleur non hexadécimale sur six chiffres : ${hex}`)

  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(match[1]?.slice(offset, offset + 2) ?? '', 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))

  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 (identiques) à 21 (noir sur blanc). */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  )

  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}
