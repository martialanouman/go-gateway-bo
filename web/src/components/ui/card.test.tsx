import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from './card'

describe('Card', () => {
  it('names its region by its title, and renders subtitle and actions in its head', () => {
    render(
      <Card actions={<button type="button">Ajouter</button>} subtitle="12 actifs" title="Webhooks">
        <p>Corps</p>
      </Card>,
    )

    const region = screen.getByRole('region', { name: 'Webhooks' })
    expect(within(region).getByRole('heading', { level: 2, name: 'Webhooks' })).toBeInTheDocument()
    expect(within(region).getByText('12 actifs')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Ajouter' })).toBeInTheDocument()
    expect(within(region).getByText('Corps')).toBeInTheDocument()
  })

  it('carries a table without inner padding when flush', () => {
    render(
      <Card flush title="Comptes">
        <table aria-label="Comptes" />
      </Card>,
    )

    const table = screen.getByRole('table', { name: 'Comptes' })
    expect(table.parentElement).toHaveClass('ui-card__body--flush')
  })
})
