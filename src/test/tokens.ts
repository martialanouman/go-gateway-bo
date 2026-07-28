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
    const css = readFileSync(join(TOKENS_DIRECTORY, file), 'utf8')
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (name && value) tokens.set(name, value.trim())
    }
  }

  return tokens
}

/** Suit les `var(--x)` jusqu'à la valeur littérale. Rend `undefined` si la chaîne ne mène nulle part. */
export function resolveToken(tokens: Map<string, string>, name: string): string | undefined {
  let value = tokens.get(name)

  // Une profondeur bornée : un alias circulaire ne doit pas suspendre la suite de tests.
  for (let depth = 0; depth < 10 && value !== undefined; depth++) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value)
    if (!reference?.[1]) return value
    value = tokens.get(reference[1])
  }

  return value
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
