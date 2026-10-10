import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chart } from './chart'
import { MetricTile } from './metric-tile'

describe('traffic primitives', () => {
  it('names the chart for assistive technologies and draws both series', () => {
    const { container } = render(
      <Chart label="Débit MT, soumis et remis" primary={[1, 3, 2]} secondary={[1, 2, 2]} />,
    )
    expect(screen.getByRole('img', { name: 'Débit MT, soumis et remis' })).toBeVisible()
    expect(container.querySelectorAll('path')).toHaveLength(3)
  })

  it('draws nothing from a single point rather than a flat lie', () => {
    const { container } = render(<Chart label="Taux d’échec" primary={[0.1]} />)
    expect(container.querySelector('path')).toBeNull()
  })

  it('says unmeasured instead of zero', () => {
    render(<MetricTile label="Sessions actives" value={null} />)
    expect(screen.getByText('non mesurée')).toBeVisible()
    expect(screen.queryByText('0')).toBeNull()
  })
})
