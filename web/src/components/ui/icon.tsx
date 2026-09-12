import type { CSSProperties, ReactElement } from 'react'

/**
 * Le jeu de glyphes de la charte, dessiné une seule fois.
 *
 * **Aucune bibliothèque, aucune police d'icônes, aucun CDN.** Ce n'est pas une économie de
 * dépendance : la charte §07 n'admet « ni pictogrammes décoratifs ni emoji, formes géométriques
 * simples et glyphes fonctionnels uniquement », et une bibliothèque rend précisément disponible ce
 * qu'elle interdit. Le jeu ci-dessous **est** le jeu complet.
 *
 * **Un nom hors du jeu ne rend rien.** Délibérément : si un contrôle semble réclamer un glyphe
 * absent, la réponse est son libellé texte. Substituer une forme voisine ferait passer une icône
 * décorative pour un glyphe fonctionnel.
 *
 * Les glyphes sont des **éléments**, pas des fonctions qui en rendent : ils sont immuables, React
 * les réutilise sans les recréer, et le module n'expose aucune fonction que personne n'appelle.
 */
const GLYPHS = {
  dot: <circle cx="8" cy="8" r="3.25" fill="currentColor" stroke="none" />,
  square: <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />,
  diamond: <path d="M8 2.6 13.4 8 8 13.4 2.6 8Z" />,
  circle: <circle cx="8" cy="8" r="5.2" />,
  warning: (
    <>
      <path d="M8 2.8 14.2 13.2H1.8Z" />
      <path d="M8 6.6v3.1" />
      <path d="M8 11.4h.01" />
    </>
  ),
  bang: (
    <>
      <path d="M8 3.4v6" />
      <path d="M8 12.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.2v3.6" />
      <path d="M8 5.2h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M8 3.4v9.2" />
      <path d="M3.4 8h9.2" />
    </>
  ),
  minus: <path d="M3.4 8h9.2" />,
  times: (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ),
  check: <path d="M3.4 8.6 6.4 11.6 12.6 4.9" />,
  'chevron-down': <path d="M4 6.4 8 10.4 12 6.4" />,
  'chevron-up': <path d="M4 9.6 8 5.6 12 9.6" />,
  'chevron-left': <path d="M9.6 4 5.6 8 9.6 12" />,
  'chevron-right': <path d="M6.4 4 10.4 8 6.4 12" />,
  'arrow-up': (
    <>
      <path d="M8 12.4V3.6" />
      <path d="M4.4 7.2 8 3.6l3.6 3.6" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M8 3.6v8.8" />
      <path d="M4.4 8.8 8 12.4l3.6-3.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.7-3.8" />
      <path d="M13 2.6v3.2h-3.2" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="3.9" />
      <path d="M10.2 10.2 13.4 13.4" />
    </>
  ),
  ban: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M4.2 11.8 11.8 4.2" />
    </>
  ),
  ellipsis: (
    <>
      <circle cx="3.6" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
} satisfies Record<string, ReactElement>

export type GlyphName = keyof typeof GLYPHS

/** Le jeu, énumérable — la planche de `/_design` le rend, et un test le compte. */
export const GLYPH_NAMES = Object.keys(GLYPHS) as readonly GlyphName[]

export type IconProps = {
  /**
   * Typé sur le jeu plutôt que `string` : un nom absent se voit au typecheck, bien avant de ne rien
   * rendre à l'écran. Le repli `null` reste, parce qu'une valeur venue d'une charge utile échappe
   * au compilateur.
   */
  readonly name: GlyphName | (string & {})
  /** 14 px dans les contrôles et les lignes, 16 px dans les en-têtes. Jamais sous 12. */
  readonly size?: number
  readonly strokeWidth?: number
  readonly className?: string
  readonly style?: CSSProperties
  /** Libellé accessible. Sans lui, le glyphe est décoratif et sort de l'arbre d'accessibilité. */
  readonly title?: string
}

export function Icon({
  name,
  size = 14,
  strokeWidth = 1.5,
  className,
  style,
  title,
}: IconProps): ReactElement | null {
  const glyph = GLYPHS[name as GlyphName]
  if (glyph === undefined) return null

  return (
    <span
      className={['ui-icon', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, ...style }}
    >
      {/*
        Le rôle et le libellé vivent sur le `<svg>`, pas sur l'enveloppe : celle-ci ne porte que la
        géométrie, et un `aria-label` sur un `<span>` sans rôle n'est pas exposé.
      */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title === undefined ? 'true' : undefined}
        aria-label={title}
        role={title === undefined ? undefined : 'img'}
      >
        {glyph}
      </svg>
    </span>
  )
}

/** Les tonalités d'un point de statut. `restricted` et `info` n'ont pas d'équivalent en pilule. */
export type DotTone = 'up' | 'degraded' | 'down' | 'restricted' | 'accent' | 'info' | 'idle'

export type DotProps = {
  readonly tone?: DotTone
  /**
   * Valeur alimentée par la WebSocket. Le pouls de 1,8 s est la **seule animation en boucle** du
   * système, et le seul signal de fraîcheur dont dispose l'opérateur : le poser sur un instantané le
   * ferait mentir.
   */
  readonly live?: boolean
  readonly className?: string
}

/**
 * Le point de statut nu — le glyphe le plus employé de la charte.
 *
 * Sa couleur vient d'une **classe**, jamais d'un style composé en JavaScript. Le plugin de tokens ne
 * lit que le CSS émis : un `background: var(--status-down)` écrit ici serait invisible pour lui, et
 * un token renommé passerait le build.
 */
export function Dot({ tone = 'idle', live = false, className }: DotProps) {
  return (
    <span
      className={['ui-dot', `ui-dot--${tone}`, live ? 'ui-dot--live' : '', className]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
