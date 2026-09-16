// @vitest-environment node

/**
 * Les classes que les primitives émettent sont-elles peintes ? Et les feuilles peignent-elles des
 * classes que personne n'émet ?
 *
 * **Le trou que ce fichier ferme est large.** Une quarantaine d'assertions de test visent une classe
 * — `toHaveClass('ui-button--danger')`, `querySelector('.ui-dot--down')`. Aucune ne traverse une
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
import type { ButtonSize, ButtonVariant } from '../src/components/ui/button'
import type { DotTone } from '../src/components/ui/icon'
import type { BreakerState } from '../src/components/ui/status-pill'
import type { ToastSeverity, ToastSource } from '../src/components/ui/toast'
import { STYLED_FILES } from './tokens'

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
  // `` `ui-dot--${tone}` `` n'en donne que le **préfixe** — il se termine par `--`, et ses valeurs
  // viennent de `FAMILIES`.
  return new Set(
    [...sources.matchAll(/['"`](ui-[\w-]*)/g)].map(([, name]) => name as string).filter(Boolean),
  )
}

/**
 * Les valeurs de chaque classe calculée.
 *
 * Comparer une règle au seul préfixe tenait une famille pour peinte dès qu'une de ses valeurs
 * l'était : retirer `.ui-dot--degraded` laissait le test vert, et une règle morte `.ui-dot--x`
 * aussi. `Record<Union, true>` rend la liste exhaustive par le typecheck : une valeur ajoutée à
 * l'union sans l'être ici, ou l'inverse, casse `tsc`.
 */
function values<T extends string>(record: Record<T, true>): readonly string[] {
  return Object.keys(record)
}

const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  // `md` n'émet aucune classe : c'est la hauteur par défaut.
  'ui-button--': values<ButtonVariant | Exclude<ButtonSize, 'md'>>({
    danger: true,
    lg: true,
    link: true,
    primary: true,
    secondary: true,
    sm: true,
  }),
  'ui-dot--': values<DotTone>({
    accent: true,
    degraded: true,
    down: true,
    idle: true,
    info: true,
    restricted: true,
    up: true,
  }),
  'ui-breaker--': values<BreakerState>({ closed: true, half_open: true, open: true }),
  'ui-toast--': values<ToastSeverity>({ critical: true, info: true, success: true, warning: true }),
  'ui-toast__source--': values<ToastSource>({ alertmanager: true, bff: true }),
}

/** Les classes émises, chaque préfixe remplacé par les classes entières de sa famille. */
function expanded(): Set<string> {
  return new Set(
    [...emitted()].flatMap((name) =>
      name.endsWith('--') ? (FAMILIES[name] ?? []).map((value) => name + value) : [name],
    ),
  )
}

/**
 * Les classes que les feuilles servies ciblent.
 *
 * **Toutes les feuilles, jamais une seule.** La première rédaction ne lisait que `components.css`,
 * la seule qui portait des `ui-*` à l'époque. Une primitive peinte ailleurs — ce que step-042 fait
 * avec `feedback.css` — serait sortie de la bijection sans qu'aucun test ne le dise : les deux
 * assertions ci-dessous auraient simplement jugé une feuille de moins, en silence. C'est exactement
 * le défaut que `STYLED_FILES` avait déjà eu, et il se referme de la même façon — une liste, deux
 * lecteurs.
 */
function painted(): Set<string> {
  const css = STYLED_FILES.map((file) =>
    readFileSync(resolve(here, '..', 'src', 'styles', file), 'utf8'),
  )
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  return new Set([...css.matchAll(/\.(ui-[\w-]+)/g)].map(([, name]) => name as string))
}

/**
 * Les crochets : des classes émises pour être **ciblées par l'appelant ou par un test**, jamais
 * peintes par aucune d'elles. Nommées une à une, et non tolérées par un motif — c'est la liste qu'on
 * relit.
 */
const HOOKS = new Set([
  // Racine des onglets : Base UI y pose ses `data-*`, la mise en page vient de `__list`.
  'ui-tabs',
  // La sévérité par défaut : `.ui-toast` la peint, et la classe ne sert qu'à la nommer.
  'ui-toast--info',
  // Le point à l'intérieur d'une pilule : `Dot` porte déjà `.ui-dot`, qui peint. Cette classe-ci
  // sert au parcours et aux tests à distinguer un point *de pilule* d'un point isolé.
  'ui-status__dot',
])

describe('les classes des primitives', () => {
  it('sont toutes peintes par une feuille servie, ou nommées comme crochets', () => {
    const rules = painted()
    const orphelines = [...expanded()].filter((name) => !HOOKS.has(name) && !rules.has(name)).sort()

    expect(orphelines, 'classes émises que rien ne peint').toEqual([])
  })

  it('ne laissent aucune règle sans émetteur', () => {
    // L'autre sens : une règle dont plus personne ne porte la classe est du poids mort servi à tous,
    // et elle se lit comme une protection qui n'agit sur rien.
    const emitters = expanded()
    const sansEmetteur = [...painted()].filter((name) => !emitters.has(name)).sort()

    expect(sansEmetteur, 'règles CSS que plus aucun composant n’émet').toEqual([])
  })

  it('énumèrent chaque famille calculée, et seulement celles-là', () => {
    // Un préfixe absent de `FAMILIES` ne s'étendrait en rien, et ses classes échapperaient aux deux
    // tests ci-dessus.
    const prefixes = [...emitted()].filter((name) => name.endsWith('--')).sort()

    expect(Object.keys(FAMILIES).sort()).toEqual(prefixes)
  })

  it('sont assez nombreuses pour que ce test garde quelque chose', () => {
    // Sans ce plancher, une expression régulière qui cesserait de reconnaître les classes rendrait
    // les tests ci-dessus verts et vides — la panne la plus discrète qu'un test puisse avoir.
    expect(emitted().size).toBeGreaterThan(20)
    expect(painted().size).toBeGreaterThan(20)
  })
})
