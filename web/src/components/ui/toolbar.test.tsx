import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Toolbar } from './toolbar'

describe('Toolbar', () => {
  it('puts the filters first and the actions at the end', () => {
    render(
      <Toolbar end={<button type="button">Nouveau</button>}>
        <label>
          Statut <select />
        </label>
      </Toolbar>,
    )

    const filter = screen.getByRole('combobox', { name: 'Statut' })
    const action = screen.getByRole('button', { name: 'Nouveau' })
    expect(filter.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action.parentElement).toHaveClass('ui-toolbar__end')
  })
})
