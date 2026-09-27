import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Popover } from './popover'

function renderPopover() {
  render(
    <Popover
      hint="Ce que le panneau ne promet pas."
      label="Notifications, 2 non lues"
      title="Notifications"
      trigger="Notifications"
    >
      <button type="button">Dans le panneau</button>
    </Popover>,
  )
}

describe('Popover', () => {
  it('names its trigger with the label, not only its visible content', () => {
    renderPopover()

    expect(screen.getByRole('button', { name: 'Notifications, 2 non lues' })).toBeInTheDocument()
  })

  it('opens with Enter, announces its title and its hint', async () => {
    const user = userEvent.setup()
    renderPopover()

    await user.tab()
    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('dialog', {
        name: 'Notifications',
        description: 'Ce que le panneau ne promet pas.',
      }),
    ).toBeInTheDocument()
  })

  it('closes with Escape and gives the focus back to its trigger', async () => {
    const user = userEvent.setup()
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'Notifications, 2 non lues' })

    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not open its hint by itself', async () => {
    const user = userEvent.setup()
    renderPopover()

    await user.click(screen.getByRole('button', { name: 'Notifications, 2 non lues' }))
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(dialog).toHaveFocus())
    expect(screen.queryAllByText('Ce que le panneau ne promet pas.')).toHaveLength(1)
  })
})
