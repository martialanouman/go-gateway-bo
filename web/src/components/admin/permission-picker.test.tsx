import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '~/lib/permissions.gen'
import { PermissionPicker } from './permission-picker'

describe('choosing a role’s permissions', () => {
  it('groups the 44 catalog keys by category, each in its named group', () => {
    render(<PermissionPicker onChange={() => undefined} selected={[]} />)

    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(new Set(PERMISSIONS.map((permission) => permission.category)).size)
    expect(screen.getAllByRole('checkbox')).toHaveLength(44)

    const admin = screen.getByRole('group', { name: 'Administration' })
    expect(within(admin).getByRole('checkbox', { name: /operators:manage/ })).toBeInTheDocument()
    expect(within(admin).getByRole('checkbox', { name: /roles:manage/ })).toBeInTheDocument()
  })

  it('says what each key grants, next to its identifier', () => {
    render(<PermissionPicker onChange={() => undefined} selected={[]} />)

    const first = PERMISSIONS[0]
    if (first === undefined) throw new Error('le catalogue est vide')
    expect(screen.getByRole('checkbox', { name: new RegExp(first.key) })).toHaveAccessibleName(
      expect.stringContaining(first.description),
    )
  })

  it('follows the keyboard: Tab reaches the first key, Space grants it, a second Tab moves to the next', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PermissionPicker onChange={onChange} selected={['routes:write']} />)

    await user.tab()
    expect(screen.getByRole('checkbox', { name: /routes:read/ })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(['routes:write', 'routes:read'])

    await user.tab()
    expect(screen.getByRole('checkbox', { name: /routes:write/ })).toHaveFocus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})
