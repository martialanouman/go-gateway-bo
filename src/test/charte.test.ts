// @vitest-environment node

/**
 * La charte, tenue par des tests.
 *
 * Deux garanties distinctes :
 *
 * 1. **Les tokens que les écrans consomment existent.** Un `var(--surface-card)` qui ne résout rien
 *    ne casse pas : le navigateur applique la valeur héritée, et l'écran s'affiche presque juste.
 *    Un token renommé se remarquerait donc des semaines plus tard, sur une capture d'écran.
 * 2. **Le contraste est conforme dès les tokens**, pas rattrapé écran par écran. C'est la seule
 *    façon d'obtenir WCAG 2.1 AA partout : un token conforme rend conforme tout ce qui l'emploie.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio, readTokens, resolveToken } from './tokens'

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

  it('la bordure de carte se distingue de la surface qu’elle délimite', () => {
    // Sur un fond quasi-noir, c'est la bordure qui porte la profondeur. Si elle disparaît, les
    // cartes fusionnent avec le canvas. WCAG 1.4.11 demande 3:1 pour un élément d'interface, mais
    // cette séparation-là est décorative — on vérifie seulement qu'elle est perceptible.
    const border = resolveToken(tokens, '--border-default')
    const surface = resolveToken(tokens, '--surface-card')

    expect(contrastRatio(border as string, surface as string)).toBeGreaterThan(1.2)
  })

  it('l’anneau de focus tranche sur le canvas', () => {
    // Un focus invisible rend la navigation au clavier impraticable (WCAG 2.4.7). L'anneau est en
    // teal ; on vérifie la couleur qui le compose, pas l'ombre portée qui l'assemble.
    const ring = resolveToken(tokens, '--teal-500')
    const page = resolveToken(tokens, '--surface-page')

    expect(contrastRatio(ring as string, page as string)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT_OR_UI,
    )
  })
})
