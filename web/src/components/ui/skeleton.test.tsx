import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadingState, Skeleton } from './skeleton'

/**
 * Le chargement est le seul des cinq états qui n'ait pas de copie : c'est une silhouette.
 *
 * Ce que ces tests tiennent n'est donc pas un texte mais une **annonce** — ce qu'entend l'opérateur
 * qui ne voit pas la silhouette. Sans elle, un lecteur d'écran lit une région vide et rien ne dit
 * qu'elle se remplit.
 */
describe('Skeleton', () => {
  it('prend la géométrie que l’écran lui donne', () => {
    // La primitive ne devine aucune mise en page : c'est l'écran qui connaît la sienne, et un
    // rectangle générique ne distingue plus le chargement de l'attente.
    const { container } = render(<Skeleton height={32} width={220} />)

    const bloc = container.querySelector('.ui-skeleton')
    expect(bloc).toHaveStyle({ width: '220px', height: '32px' })
  })
})

describe('LoadingState', () => {
  it('s’annonce comme occupé, et dit poliment ce qui charge', () => {
    render(
      <LoadingState>
        <Skeleton width={220} />
      </LoadingState>,
    )

    const region = screen.getByText('Chargement…').closest('.ui-loading')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('laisse l’écran nommer ce qu’il charge', () => {
    // « Chargement… » est un repli, pas une cible : un opérateur qui attend trois régions veut
    // savoir laquelle parle.
    render(
      <LoadingState label="Chargement des connecteurs">
        <Skeleton />
      </LoadingState>,
    )

    expect(screen.getByText('Chargement des connecteurs')).toBeInTheDocument()
  })

  it('porte la silhouette que l’écran compose', () => {
    const { container } = render(
      <LoadingState>
        <Skeleton width={150} />
        <Skeleton width={80} />
      </LoadingState>,
    )

    expect(container.querySelectorAll('.ui-skeleton')).toHaveLength(2)
  })
})
