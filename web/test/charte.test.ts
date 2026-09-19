// @vitest-environment node

/**
 * La charte, tenue par des tests. Deux garanties distinctes :
 *
 * 1. **Les tokens que les écrans consomment existent.** Un `var()` qui ne résout rien ne casse pas :
 *    le navigateur applique la valeur héritée, et l'écran s'affiche presque juste — un token renommé
 *    ne se remarquerait que des semaines plus tard, sur une capture d'écran. La garde part donc de ce
 *    que le CSS **consomme réellement**, jamais d'une liste écrite à la main, qui ne verrait jamais le
 *    token qu'on vient d'inventer. `vite-plugin-tokens` tient le même front sur le CSS émis ; ce
 *    fichier garde ce que le plugin ne voit pas — les `var()` composés à l'exécution.
 * 2. **Le contraste est conforme dès les tokens**, pas rattrapé écran par écran — sur les surfaces
 *    plates *et* composées. Ces dernières sont le vrai point bas : une pilule pose son texte sur sa
 *    propre teinte, une ligne se survole et se sélectionne. Un test qui ne regarderait que les fonds
 *    littéraux de la palette laisserait passer les combinaisons que le produit rend réellement.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst, preprocessCSS, resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import { CONTRAST_PAIRS, RADII, SPACINGS, SURFACES, TYPE_ROLES } from '../src/lib/design-tokens'
import {
  contrastRatio,
  readTokens,
  resolveColor,
  resolveToken,
  STYLED_FILES,
  TOKEN_FILES,
} from './tokens'

const tokens = readTokens()

function readStyledCss(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // Les commentaires sortent d'abord : ils citent des noms de tokens, et les compter comme consommés
  // ferait rougir pour la mauvaise raison.
  return STYLED_FILES.map((file) =>
    readFileSync(join(resolve(here, '..'), 'src', 'styles', file), 'utf8'),
  )
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Seuils WCAG 2.1 AA. Le texte large commence à 18,66 px en gras ou 24 px en normal. */
const AA_NORMAL_TEXT = 4.5
const AA_LARGE_TEXT_OR_UI = 3

describe('tokens de la charte', () => {
  const expected = [
    // Surfaces — la charte en définit quatre, et il n'y a pas de thème clair.
    '--surface-page',
    '--surface-chrome',
    '--surface-card',
    '--surface-sunken',
    // Texte
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--text-faint',
    // Bordures : sur ce fond, c'est la bordure qui porte la profondeur, pas l'ombre.
    '--border-default',
    '--border-subtle',
    // Accent unique
    '--teal-500',
    // Sémantique de statut
    '--green-500',
    '--amber-500',
    '--red-500',
    '--blue-500',
    '--violet-500',
    // Rôles typographiques : six pour l'interface, trois pour les valeurs machine.
    '--text-page-title',
    '--text-section-title',
    '--text-card-title',
    '--text-body',
    '--text-label',
    '--text-overline',
    '--text-metric',
    '--text-data',
    '--text-pill',
    // Familles
    '--font-sans',
    '--font-mono',
    // Espacements canoniques : 4 · 8 · 12 · 16 · 24 · 40
    '--sp-2',
    '--sp-4',
    '--sp-6',
    '--sp-7',
    '--sp-9',
    '--sp-11',
    // Rayons
    '--r-field',
    '--r-card',
    '--r-pill',
    // Accessibilité
    '--focus-ring',
  ]

  it.each(expected)('%s est défini', (name) => {
    expect(resolveToken(tokens, name)).toBeDefined()
  })

  it('assemble tout ce que la charte a besoin de servir', () => {
    // Retirer `@import "./tokens/base.css"` d'app.css laisse la suite verte et `vite build` à rc=0 —
    // mesuré — alors que `base.css` porte seul le reset, `color-scheme: dark` et la règle
    // `:focus-visible` qui pose l'anneau sur tous les contrôles (WCAG 2.4.7). L'assemblage se teste
    // ici plutôt que par le rendu : aucune règle de `base.css` n'a de porteur dans le DOM de test.
    const here = dirname(fileURLToPath(import.meta.url))
    const app = readFileSync(join(resolve(here, '..'), 'src', 'styles', 'app.css'), 'utf8')

    const assembled = [...app.matchAll(/@import\s+"\.\/(tokens\/[\w-]+\.css)"/g)].map(
      ([, file]) => file as string,
    )

    expect(assembled).toEqual([...TOKEN_FILES.map((file) => `tokens/${file}`), 'tokens/base.css'])
  })

  it('inscrit dans STYLED_FILES chaque feuille qui existe', () => {
    // Les gardes ci-dessous **parcourent** `STYLED_FILES` : en retirer une entrée n'en fait échouer
    // aucune, elles vérifient une feuille de moins en silence — mesuré en retirant `components.css`,
    // la plus grosse du produit, sans qu'un seul test bouge. La liste reste nommée plutôt que
    // globbée, parce qu'on veut la relire ; ce test dit seulement qu'elle est *complète*.
    const here = dirname(fileURLToPath(import.meta.url))
    const styles = resolve(here, '..', 'src', 'styles')

    const onDisk = readdirSync(styles, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
      .map((entry) =>
        join(entry.parentPath, entry.name)
          .slice(styles.length + 1)
          .replaceAll('\\', '/'),
      )

    // Les fichiers de `tokens/` sont gardés autrement — `readTokens()` les lit tous pour en tirer les
    // déclarations. `tokens/base.css`, lui, porte des **règles** et non des tokens : il est dans
    // STYLED_FILES.
    const accounted = new Set<string>([
      ...STYLED_FILES,
      ...TOKEN_FILES.map((file) => `tokens/${file}`),
    ])

    expect(onDisk.length, 'aucune feuille trouvée : ce test ne garde rien').toBeGreaterThan(5)
    expect(onDisk.filter((file) => !accounted.has(file)).sort()).toEqual([])
  })

  it('sert chaque feuille que STYLED_FILES prétend garder', async () => {
    // Une feuille qu'aucun module n'importe n'est pas servie, et la garantie ci-dessus se met alors à
    // juger un fichier mort : retirer l'import de `design-reference.css` de la route laisse la suite
    // verte et `vite build` à rc=0 — mesuré — pendant que la page rend nue.
    //
    // Les imports sont lus par l'analyseur et les `@import` résolus par Vite : un import commenté
    // contient encore le nom de la feuille, et une recherche dans le texte le compterait.
    const web = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const config = await resolveConfig({ root: web, logLevel: 'silent' }, 'build')

    const imported = ['src/main.tsx', 'src/routes/[_]design.tsx'].flatMap((file) =>
      parseAst(readFileSync(join(web, file), 'utf8'), { lang: 'tsx' })
        .body.flatMap((node) => (node.type === 'ImportDeclaration' ? [node.source.value] : []))
        .filter((specifier) => specifier.endsWith('.css'))
        .map((specifier) => join(web, 'src', specifier.replace(/^~\//, ''))),
    )

    const served = new Set(imported)
    for (const sheet of imported) {
      const { deps } = await preprocessCSS(readFileSync(sheet, 'utf8'), sheet, config)
      for (const dep of deps ?? []) served.add(dep)
    }

    expect(served.size, 'aucune feuille trouvée : ce test ne garde rien').toBeGreaterThan(5)
    for (const file of STYLED_FILES) {
      expect(served, `${file} n'est importée par aucun module : elle n'est pas servie`).toContain(
        join(web, 'src', 'styles', file),
      )
    }
  })

  /**
   * Les variables que **Base UI écrit à l'exécution**, et qui ne sont donc pas des tokens de la
   * charte : l'indicateur d'onglets et le positionneur du select les posent par `style.setProperty()`
   * une fois la mesure faite. La garde ci-dessous exige que tout `var()` vienne de `tokens/` ; ces
   * trois-là n'en viendront jamais.
   *
   * Nommées plutôt que tolérées par un motif : trois lignes qu'on relit, et tout le reste demeure
   * fermé. Le test suivant vérifie qu'aucune ne vit sans repli — sans quoi cette liste les rendrait
   * simplement invisibles.
   */
  const RUNTIME_VARIABLES = ['--active-tab-left', '--active-tab-width', '--anchor-width'] as const

  it('n’en consomme aucun qui n’existe pas', () => {
    // Le plugin tient déjà ce front sur le CSS émis ; ce test le tient sur les sources, et il rougit
    // plus tôt — à `make test-web` plutôt qu'à `make build`.
    const used = new Set(
      [...readStyledCss().matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name]) => name as string),
    )

    const fromRuntime = new Set<string>(RUNTIME_VARIABLES)

    expect([...used].filter((name) => !tokens.has(name) && !fromRuntime.has(name)).sort()).toEqual(
      [],
    )
  })

  it('donne une valeur de repli à chaque variable que le JavaScript écrira', () => {
    // Le repli ne sert pas qu'à satisfaire le plugin : il donne une valeur **au premier rendu**,
    // avant que le composant n'ait mesuré quoi que ce soit — sans lui, l'indicateur d'onglet
    // apparaîtrait à largeur nulle le temps d'une image. Sans ce test, `RUNTIME_VARIABLES` ci-dessus
    // suffirait à faire taire la garde précédente et le repli pourrait disparaître en silence.
    const here = dirname(fileURLToPath(import.meta.url))
    const components = readFileSync(
      join(resolve(here, '..'), 'src', 'styles', 'components.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')

    // **Dans `:root`, et pas seulement « quelque part ».** Chercher le nom dans tout le fichier
    // laisse passer les trois déclarations déplacées vers `.ui-select__popup` — mesuré, suite et
    // `vite build` verts — alors que l'indicateur d'onglets n'a plus aucun ancêtre qui les déclare.
    const root = /:root\s*\{([^}]*)\}/.exec(components)?.[1]
    expect(root, 'components.css ne déclare plus de bloc :root').toBeDefined()

    const declared = new Set(
      [...(root ?? '').matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name as string),
    )

    for (const name of RUNTIME_VARIABLES) {
      expect(
        declared,
        `${name} n'est pas déclarée dans :root : ses consommateurs la liront vide`,
      ).toContain(name)
    }
  })

  it('en consomme assez pour que ce test garde quelque chose', () => {
    // Sans ce plancher, une expression régulière qui cesserait de reconnaître `var(--…)` rendrait le
    // test précédent vert et vide — la panne la plus discrète qu'un test puisse avoir.
    expect([...readStyledCss().matchAll(/var\(\s*(--[\w-]+)/g)].length).toBeGreaterThan(40)
  })

  it('ne rend, dans /_design, que des tokens qui existent', () => {
    // Le trou que `vite-plugin-tokens` nomme : la page compose ses `var()` à l'exécution
    // (`style={{ font: `var(${token})` }}`), donc **aucun de ces noms n'apparaît dans le CSS émis**.
    // Le build ne peut pas les voir ; cette table est le seul endroit d'où ils viennent.
    const named = [
      ...TYPE_ROLES.map(({ token }) => token),
      ...SURFACES.map(({ token }) => token),
      ...RADII.map(({ token }) => token),
      ...SPACINGS,
      ...CONTRAST_PAIRS.flatMap(({ text, background, over }) => [text, background, over ?? '']),
    ].filter(Boolean)

    expect(named.filter((name) => !tokens.has(name)).sort()).toEqual([])
  })

  it('ne promet pas de thème clair', () => {
    // La charte est sombre, sans bascule. Un token de thème clair signalerait qu'une variante a
    // été introduite sans que la décision soit prise.
    const suspects = [...tokens.keys()].filter((name) => /light|day|inverse-theme/.test(name))
    expect(suspects).toEqual([])
  })
})

describe('contraste WCAG 2.1 AA', () => {
  const backgrounds = ['--surface-page', '--surface-card', '--surface-chrome', '--surface-sunken']

  /** Tout ce qui rend du texte de taille courante doit tenir 4,5:1 sur chaque surface. */
  const textColors = [
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    // Porte `--text-data-sm` en 11 px : c'est du texte normal, pas du grand texte. Il a fallu
    // l'éclaircir par rapport à la charte v1.0 pour qu'il tienne ce seuil — voir `colors.css`.
    '--text-faint',
    '--text-link',
  ]

  /** Un état se lit aussi en couleur : ces teintes portent du texte de pilule et des libellés. */
  const statusColors = [
    '--teal-500',
    '--green-500',
    '--amber-500',
    '--red-500',
    '--blue-500',
    '--violet-500',
  ]

  const pairs = backgrounds.flatMap((background) =>
    [...textColors, ...statusColors].map((foreground) => ({ foreground, background })),
  )

  it.each(pairs)('$foreground sur $background atteint 4,5:1', ({ foreground, background }) => {
    const fg = resolveToken(tokens, foreground)
    const bg = resolveToken(tokens, background)
    expect(fg, `${foreground} introuvable`).toBeDefined()
    expect(bg, `${background} introuvable`).toBeDefined()

    expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  describe('surfaces composées', () => {
    // Une teinte est peinte sur la surface qui la porte : le contraste réel dépend donc des deux.
    const surfaces = ['--surface-page', '--surface-card'] as const

    /** Chaque pilule pose son libellé sur sa propre teinte — la combinaison la plus fréquente. */
    const tinted = [
      { text: '--teal-500', background: '--tint-teal' },
      { text: '--green-500', background: '--tint-green' },
      { text: '--amber-500', background: '--tint-amber' },
      { text: '--blue-500', background: '--tint-blue' },
      { text: '--violet-500', background: '--tint-violet' },
      // Le rouge de pleine surface ne tient pas sur sa propre teinte (4,05 sur carte) : c'est la
      // variante claire qui porte le texte, et c'est tout l'intérêt de la tester ici.
      { text: '--text-danger-on-tint', background: '--tint-red' },
    ] as const

    const pairs = surfaces.flatMap((surface) => tinted.map((pair) => ({ ...pair, surface })))

    it.each(pairs)('$text sur $background posé sur $surface', ({ text, background, surface }) => {
      const base = resolveColor(tokens, surface)
      expect(base, `${surface} non résoluble`).toBeDefined()

      const fg = resolveColor(tokens, text, base as string)
      const bg = resolveColor(tokens, background, base as string)
      expect(fg, `${text} non résoluble`).toBeDefined()
      expect(bg, `${background} non résoluble`).toBeDefined()

      expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    })

    /**
     * Survol et sélection changent le fond sous un texte qui, lui, ne change pas.
     *
     * **Les deux porteuses, pas une.** `--surface-selected` est une teinte translucide : son rendu
     * dépend de la surface qui la porte, et les tables du produit vivent dans des cartes autant que
     * sur le canvas. Ne composer que sur le canvas retiendrait le cas le plus clément.
     * `--surface-hover` et `--surface-active`, elles, sont opaques (`color-mix(…, var(--n-800))`) :
     * la porteuse ne change rien pour elles, et les tester deux fois ne coûte que deux assertions.
     */
    const carriers = ['--surface-page', '--surface-card'] as const
    const interactive = ['--surface-hover', '--surface-active', '--surface-selected'] as const

    /**
     * `--text-faint` n'est **pas** de la partie, et c'est une règle de la charte plutôt qu'une
     * exemption de confort : sur une surface interactive, le texte le plus discret remonte d'un cran.
     * Mesuré — sur une ligne sélectionnée il rend 4,56 sur le canvas mais **4,21** en carte, sous AA,
     * et une ligne sélectionnée porte donc son texte discret en `--text-muted` (4,55 en carte).
     * L'éclaircir davantage est l'autre issue, fermée : `--n-300` (#848f9e) touche déjà `--n-200`
     * (#8b95a3), et les confondre supprimerait un échelon de l'échelle.
     */
    const readable = ['--text-primary', '--text-muted'] as const

    const interactivePairs = carriers.flatMap((carrier) =>
      interactive.flatMap((surface) => readable.map((text) => ({ text, surface, carrier }))),
    )

    it.each(interactivePairs)(
      '$text reste lisible sur $surface, posé sur $carrier',
      ({ text, surface, carrier }) => {
        const base = resolveColor(tokens, carrier) as string
        const bg = resolveColor(tokens, surface, base)
        const fg = resolveColor(tokens, text, base)
        expect(bg, `${surface} non résoluble`).toBeDefined()
        expect(fg, `${text} non résoluble`).toBeDefined()

        expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      },
    )
  })

  /**
   * **Les paires que `/_design` rend réellement.** Les listes croisées ci-dessus couvrent la palette
   * systématiquement ; celle-ci couvre ce que la page affiche, sous un libellé qui promet à son
   * lecteur « chaque ligne est vérifiée à 4,5:1 par ce fichier ». Sans ce bloc, une paire à 2,53:1
   * ajoutée à la table laisse la suite verte et la page l'affiche comme vérifiée — mesuré.
   *
   * Les deux jeux se recouvrent, et c'est voulu : les croisements attrapent une couleur qui se
   * dégrade partout, celui-ci attrape une **combinaison** que quelqu'un décide de montrer.
   */
  it.each(CONTRAST_PAIRS)(
    '$text sur $background atteint 4,5:1 — $usage',
    ({ text, background, over }) => {
      // `over` nomme la surface porteuse quand le fond est translucide : sans elle, la teinte se
      // composerait sur du noir et le ratio ne correspondrait à rien de ce qui est peint.
      const base = resolveColor(tokens, over ?? '--surface-page') as string
      const fg = resolveColor(tokens, text, base)
      const bg = resolveColor(tokens, background, base)

      expect(fg, `${text} non résoluble`).toBeDefined()
      expect(bg, `${background} non résoluble`).toBeDefined()
      expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    },
  )

  /**
   * Le juge lui-même. Sans ce cas, abaisser `AA_NORMAL_TEXT` de 4,5 à 1 désarmait tout l'appareil de
   * contraste sans qu'une seule porte ne bronche — mesuré. Une paire dont on **sait** qu'elle échoue
   * prouve que la machinerie sait refuser, et non seulement accepter.
   */
  it('sait refuser une paire non conforme', () => {
    const faint = resolveColor(tokens, '--n-400') as string
    const page = resolveColor(tokens, '--surface-page') as string

    expect(contrastRatio(faint, page)).toBeLessThan(AA_NORMAL_TEXT)
  })

  it('la bordure de carte se distingue de la surface qu’elle délimite', () => {
    // Sur un fond quasi-noir, c'est la bordure qui porte la profondeur. Si elle disparaît, les
    // cartes fusionnent avec le canvas. WCAG 1.4.11 demande 3:1 pour un élément d'interface, mais
    // cette séparation-là est décorative — on vérifie seulement qu'elle est perceptible.
    const border = resolveColor(tokens, '--border-default')
    const surface = resolveColor(tokens, '--surface-card')

    expect(contrastRatio(border as string, surface as string)).toBeGreaterThan(1.2)
  })

  it('l’anneau de focus tranche sur le canvas', () => {
    // Un focus invisible rend la navigation au clavier impraticable (WCAG 2.4.7).
    //
    // **Ce test lit `--focus-ring` lui-même, et c'est tout son intérêt** : mesuré en repeignant
    // l'anneau en `--n-700` — un gris à 1,64:1 sur la page, invisible —, la suite, `vite build` et le
    // parcours Playwright restent verts. Le parcours compte les deux *couches* de l'ombre, jamais
    // leur couleur.
    //
    // La dernière couleur de l'ombre est celle qu'on voit : la première est un repli de la couleur
    // de la page, qui sépare l'anneau du contrôle.
    const declared = resolveToken(tokens, '--focus-ring')
    expect(declared, '--focus-ring a disparu de la charte').toBeDefined()

    const composed = [...(declared as string).matchAll(/var\(\s*(--[\w-]+)/g)].map(
      ([, name]) => name as string,
    )
    expect(composed.length, "l'anneau ne compose plus aucun token").toBeGreaterThanOrEqual(2)

    const page = resolveColor(tokens, '--surface-page') as string
    const visible = resolveColor(tokens, composed[composed.length - 1] as string, page)
    expect(visible, `${composed.at(-1)} n'est pas résoluble`).toBeDefined()

    expect(
      contrastRatio(visible as string, page),
      `l'anneau de focus ne tranche pas sur la page : ${composed.at(-1)}`,
    ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_UI)
  })

  /**
   * **La dette du raccourci `font:`, fermée sur son mécanisme plutôt que sur ses symptômes.**
   *
   * `font: var(--text-body)` est un raccourci : il réinitialise `font-variant-numeric`, et défait
   * donc les `tabular-nums` que `tokens/base.css` pose sur `body`. Une colonne de nombres en police
   * proportionnelle perd sa chasse commune et **danse** à chaque rafraîchissement — dans un cockpit
   * où les compteurs défilent, c'est le défaut qu'on remarque sans savoir le nommer.
   *
   * La garde ne juge donc pas une liste de règles mais la **propriété** : toute règle qui pose un
   * rôle en police proportionnelle doit reprendre `tabular-nums`. Les rôles concernés sont dérivés de
   * `typography.css` — ceux qui composent `--font-sans` — et non recopiés : une liste écrite à la
   * main ne verrait jamais le rôle qu'on vient d'ajouter.
   */
  it('reprend tabular-nums partout où un rôle proportionnel est posé', () => {
    const proportional = new Set(
      [...tokens.entries()]
        .filter(([name, value]) => name.startsWith('--text-') && value.includes('--font-sans'))
        .map(([name]) => name),
    )

    expect(
      proportional.size,
      'aucun rôle proportionnel trouvé : cette garde ne garde rien',
    ).toBeGreaterThan(4)

    // Un bloc CSS, de son sélecteur à son accolade fermante. On juge **le bloc** et non la ligne :
    // l'ordre des deux déclarations est indifférent au navigateur, seule leur coexistence compte.
    const blocks = readStyledCss().matchAll(/([^{}]+)\{([^{}]*)\}/g)

    const fautives: string[] = []
    for (const [, selector, body] of blocks) {
      const role = /font:\s*var\((--text-[\w-]+)\)/.exec(body ?? '')?.[1]
      if (role === undefined || !proportional.has(role)) continue
      if ((body ?? '').includes('font-variant-numeric')) continue

      fautives.push(`${(selector ?? '').trim()} { font: var(${role}) }`)
    }

    expect(
      fautives,
      'un rôle proportionnel posé sans reprendre `tabular-nums` : les chiffres y perdent leur chasse commune',
    ).toEqual([])
  })
})
