import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from './switch'

describe('Switch', () => {
  it('names itself by its label and describes itself by its hint', () => {
    render(
      <Switch checked description="Bind des clients SMPP" label="SMPP" onCheckedChange={vi.fn()} />,
    )

    const control = screen.getByRole('switch', { name: 'SMPP' })
    expect(control).toBeChecked()
    expect(control).toHaveAccessibleDescription('Bind des clients SMPP')
  })

  it('answers the keyboard as the mouse', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch checked label="REST" onCheckedChange={onCheckedChange} />)

    await user.tab()
    expect(screen.getByRole('switch', { name: 'REST' })).toHaveFocus()
    await user.keyboard(' ')

    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })

  it('stays reachable when forbidden, says why, and changes nothing', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(
      <Switch
        blockedReason="Modifier un compte demande accounts:write."
        checked
        description="Bind des clients SMPP"
        label="SMPP"
        onCheckedChange={onCheckedChange}
      />,
    )

    const control = screen.getByRole('switch', { name: 'SMPP' })
    expect(control).toHaveAttribute('aria-disabled', 'true')
    expect(control).toHaveAccessibleDescription(
      'Bind des clients SMPP Modifier un compte demande accounts:write.',
    )
    await user.tab()
    expect(control).toHaveFocus()
    await user.click(control)

    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(control).toBeChecked()
  })

  it('keeps its name for screen readers when compact, as in a table cell', () => {
    render(<Switch checked compact label="Webhook DLR actif" onCheckedChange={vi.fn()} />)

    expect(screen.getByRole('switch', { name: 'Webhook DLR actif' })).toBeChecked()
    expect(screen.getByText('Webhook DLR actif')).toHaveClass('ui-visually-hidden')
  })
})
