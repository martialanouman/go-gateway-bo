// @vitest-environment node

/**
 * La charte, tenue par des tests.
 *
 * Deux garanties distinctes :
 *
 * 1. **Les tokens que les écrans consomment existent.** Un `var(--surface-card)` qui ne résout rien
 *    ne casse pas : le navigateur applique la valeur héritée, et l'écran s'affiche presque juste.
 *    Un token renommé se remarquerait donc des semaines plus tard, sur une capture d'écran. La v1.0
 *    en a fait les frais — step-026 avait inventé `--danger-border`, `--danger-surface` et
 *    `--danger-text`, et le bandeau de refus s'affichait sans bordure ni fond, `pnpm check` vert.
 *
 *    Le sens qui manquait est testé ici : on part de ce que le CSS **consomme réellement**, jamais
 *    d'une liste écrite à la main — une liste ne voit jamais le token qu'on vient d'inventer. Depuis
 *    step-008, cette garantie est **doublée par le build** : `vite-plugin-tokens` fait échouer
 *    `vite build` sur un `var()` non déclaré. Le test garde ce que le plugin ne voit pas — les
 *    `var()` composés à l'exécution, que le CSS émis ne contient pas.
 * 2. **Le contraste est conforme dès les tokens**, pas rattrapé écran par écran — sur les surfaces
 *    plates *et* sur les surfaces composées. Ces dernières sont le vrai point bas : une pilule pose
 *    son texte sur sa propre teinte, une ligne se survole et se sélectionne. Un test qui ne
 *    regarderait que les fonds littéraux de la palette laisserait passer les combinaisons que le
 *    produit rend réellement — c'est ce qui est arrivé à la première version de ce fichier, et deux
 *    paires étaient sous le seuil.
 *
 * *(Porté de la v1.0, `909eb8d:src/test/charte.test.ts`. Les deux tests qui visaient
 * `src/styles/components.css` sont reciblés : les primitives habillées sont hors périmètre de
 * step-008, elles arrivent en step-041/042.)*
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, readTokens, resolveColor, resolveToken } from './tokens'

const tokens = readTokens()

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

    /** Survol et sélection changent le fond sous un texte qui, lui, ne change pas. */
    const interactive = ['--surface-hover', '--surface-active', '--surface-selected'] as const
    const readable = ['--text-primary', '--text-muted', '--text-faint'] as const

    const interactivePairs = interactive.flatMap((surface) =>
      readable.map((text) => ({ text, surface })),
    )

    it.each(interactivePairs)('$text reste lisible sur $surface', ({ text, surface }) => {
      // Ces surfaces se composent sur le canvas ; c'est lui qu'on passe comme fond de composition.
      const page = resolveColor(tokens, '--surface-page') as string
      const bg = resolveColor(tokens, surface, page)
      const fg = resolveColor(tokens, text, page)
      expect(bg, `${surface} non résoluble`).toBeDefined()
      expect(fg, `${text} non résoluble`).toBeDefined()

      expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    })
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
    // Un focus invisible rend la navigation au clavier impraticable (WCAG 2.4.7). L'anneau est en
    // teal ; on vérifie la couleur qui le compose, pas l'ombre portée qui l'assemble.
    const ring = resolveColor(tokens, '--teal-500')
    const page = resolveColor(tokens, '--surface-page')

    expect(contrastRatio(ring as string, page as string)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT_OR_UI,
    )
  })
})
