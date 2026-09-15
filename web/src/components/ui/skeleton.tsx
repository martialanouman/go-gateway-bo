import type { CSSProperties, ReactNode } from 'react'

/**
 * Le chargement : une silhouette de la vraie mise en page, jamais un rond qui tourne.
 *
 * « Un spinner est un blanc décoré : il ne dit pas ce qui arrive, et la mise en page sursaute quand
 * le contenu le remplace. » Le dépôt en a déjà un exemplaire, celui du chargement à froid, écrit en
 * ligne dans `index.html` parce qu'aucune feuille n'est chargée à la première peinture. Celui-ci est
 * son équivalent **à l'intérieur d'un écran** ; les deux battent au même rythme, `--dur-skeleton`.
 *
 * **La primitive ne devine aucune mise en page.** Elle donne un bloc et une annonce ; c'est l'écran
 * qui compose la silhouette de ses propres colonnes, parce que lui seul les connaît. `SkeletonRows`
 * — la composition tabulaire du kit — arrivera avec la première step qui livre une table peuplée,
 * pas avant qu'on sache quelles tables elle sert.
 */

export type SkeletonProps = {
  readonly width?: number | string
  readonly height?: number | string
  readonly className?: string
}

/**
 * Pas de prop `radius` : le kit en a une, aucun appelant n'en a besoin, et une branche que rien
 * n'exerce est une promesse que personne ne vérifie. Le premier squelette qui devra épouser un
 * rayon de carte l'ajoutera avec son écran.
 */
export function Skeleton({ width = '100%', height = 10, className }: SkeletonProps) {
  // La géométrie est un style composé, et elle seule : la couleur, le rayon et l'animation viennent
  // de la classe. Le plugin de tokens ne lit que le CSS émis — un `background: var(--n-700)` écrit
  // ici lui serait invisible, et un token renommé passerait le build.
  const style: CSSProperties = { width, height }

  return <span className={['ui-skeleton', className].filter(Boolean).join(' ')} style={style} />
}

export type LoadingStateProps = {
  /** Ce qui charge. Le repli suffit à une seule région ; trois en attente veulent trois libellés. */
  readonly label?: string
  readonly children: ReactNode
  readonly className?: string
}

/**
 * La région qui attend, et ce qu'elle annonce.
 *
 * `aria-busy` et `aria-live` portent l'information ; l'animation n'est qu'un indice, et
 * `prefers-reduced-motion` la coupe sans rien retirer à personne. Le libellé est masqué à l'œil —
 * la silhouette le dit déjà — mais **jamais par `display: none`**, qui le retirerait aussi de
 * l'arbre d'accessibilité et rendrait la région muette.
 */
export function LoadingState({ label = 'Chargement…', children, className }: LoadingStateProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={['ui-loading', className].filter(Boolean).join(' ')}
    >
      <span className="ui-loading__label">{label}</span>
      {children}
    </div>
  )
}
