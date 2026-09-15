// @vitest-environment node

/**
 * Les classes que les primitives émettent sont-elles peintes ? Et la feuille peint-elle des classes
 * que personne n'émet ?
 *
 * **Le trou que ce fichier ferme est large.** Une quarantaine d'assertions de test visent une classe
 * — `toHaveClass('ui-button--danger')`, `querySelector('.ui-dot--down')`. Aucune ne traverse la
 * feuille : elles relisent la chaîne que le composant vient de construire. Mesuré le 12/09/2026 en
 * renommant `.ui-table__cell--mono` en `.ui-table__cell--machine` **dans le CSS seulement** : les
 * 214 tests, `vite build` et le parcours Playwright restaient verts, et toutes les valeurs machine
 * du produit perdaient leur police mono.
 *
 * Le défaut symétrique — un sélecteur que rien n'émet — est celui que Biome avait signalé sur
 * `.ui-input-wrap--icon`, mais seulement parce qu'il créait une spécificité descendante. Le linter
 * ne voit ni l'un ni l'autre en général.
 *
 * Ce qu'il ne garde pas : qu'une règle **fasse** ce qu'elle prétend. Une classe peut être ciblée par
 * une règle vide. C'est le rôle du parcours Playwright, seul endroit où l'on lit ce qui est peint.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const ui = resolve(here, '..', 'src', 'components', 'ui')

/** Les littéraux `'ui-…'` des composants, commentaires retirés — ils en citent. */
function emitted(): Set<string> {
  const sources = readdirSync(ui)
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .map((file) => readFileSync(join(ui, file), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  // Deux formes, et il faut les distinguer : `'ui-status'` est une classe entière, tandis que
  // `` `ui-dot--${tone}` `` n'en donne que le **préfixe** — la valeur est calculée à l'exécution.
  // Un préfixe se reconnaît à ce qu'il se termine par `--`, et on le compare alors par début de
  // chaîne : c'est tout ce qu'une lecture statique peut honnêtement affirmer.
  return new Set(
    [...sources.matchAll(/['"`](ui-[\w-]*)/g)].map(([, name]) => name as string).filter(Boolean),
  )
}

/** Une classe peinte est-elle couverte par un littéral entier, ou par un préfixe composé ? */
function couvertePar(name: string, literals: Set<string>): boolean {
  if (literals.has(name)) return true

  return [...literals].some((literal) => literal.endsWith('--') && name.startsWith(literal))
}

/** Les classes que la feuille cible. */
function painted(): Set<string> {
  const css = readFileSync(resolve(here, '..', 'src', 'styles', 'components.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )

  return new Set([...css.matchAll(/\.(ui-[\w-]+)/g)].map(([, name]) => name as string))
}

/**
 * Les crochets : des classes émises pour être **ciblées par l'appelant ou par un test**, jamais
 * peintes par cette feuille. Nommées une à une, et non tolérées par un motif — c'est la liste qu'on
 * relit.
 */
const HOOKS = new Set([
  // Racine des onglets : Base UI y pose ses `data-*`, la mise en page vient de `__list`.
  'ui-tabs',
  // Le point à l'intérieur d'une pilule : `Dot` porte déjà `.ui-dot`, qui peint. Cette classe-ci
  // sert au parcours et aux tests à distinguer un point *de pilule* d'un point isolé.
  'ui-status__dot',
])

describe('les classes des primitives', () => {
  it('sont toutes peintes par la feuille, ou nommées comme crochets', () => {
    const rules = painted()
    const orphelines = [...emitted()]
      .filter((name) => !HOOKS.has(name))
      .filter((name) =>
        name.endsWith('--')
          ? // Un préfixe composé est couvert dès qu'une règle le prolonge : `ui-dot--` par
            // `.ui-dot--up`. Zéro règle veut dire que **toute** la famille de tonalités est morte.
            ![...rules].some((rule) => rule.startsWith(name))
          : !rules.has(name),
      )
      .sort()

    expect(orphelines, 'classes émises que rien ne peint').toEqual([])
  })

  it('ne laissent aucune règle sans émetteur', () => {
    // L'autre sens : une règle dont plus personne ne porte la classe est du poids mort servi à tous,
    // et elle se lit comme une protection qui n'agit sur rien.
    const literals = emitted()
    const sansEmetteur = [...painted()].filter((name) => !couvertePar(name, literals)).sort()

    expect(sansEmetteur, 'règles CSS que plus aucun composant n’émet').toEqual([])
  })

  it('sont assez nombreuses pour que ce test garde quelque chose', () => {
    // Sans ce plancher, une expression régulière qui cesserait de reconnaître les classes rendrait
    // les deux tests ci-dessus verts et vides — la panne la plus discrète qu'un test puisse avoir.
    expect(emitted().size).toBeGreaterThan(20)
    expect(painted().size).toBeGreaterThan(20)
  })
})
