import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toolbar } from './page'

describe('Toolbar', () => {
  it('range les actions à part, et ne rend pas de zone vide sans elles', () => {
    const { container, rerender } = render(
      <Toolbar end={<button type="button">Exporter</button>}>Filtres</Toolbar>,
    )
    expect(container.querySelector('.toolbar__end')).toContainElement(screen.getByRole('button'))

    rerender(<Toolbar>Filtres</Toolbar>)
    expect(container.querySelector('.toolbar__end')).toBeNull()
  })
})
