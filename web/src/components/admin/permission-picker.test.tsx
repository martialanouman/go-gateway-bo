import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '~/lib/permissions.gen'
import { PermissionPicker } from './permission-picker'

describe('le choix des permissions d’un rôle', () => {
  it('groupe les 44 clés du catalogue par catégorie, chacune dans son groupe nommé', () => {
    render(<PermissionPicker onChange={() => undefined} selected={[]} />)

    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(new Set(PERMISSIONS.map((permission) => permission.category)).size)
    expect(screen.getAllByRole('checkbox')).toHaveLength(44)

    const admin = screen.getByRole('group', { name: 'Administration' })
    expect(within(admin).getByRole('checkbox', { name: /operators:manage/ })).toBeInTheDocument()
    expect(within(admin).getByRole('checkbox', { name: /roles:manage/ })).toBeInTheDocument()
  })

  it('dit ce que chaque clé accorde, à côté de son identifiant', () => {
    render(<PermissionPicker onChange={() => undefined} selected={[]} />)

    const first = PERMISSIONS[0]
    if (first === undefined) throw new Error('le catalogue est vide')
    expect(screen.getByRole('checkbox', { name: new RegExp(first.key) })).toHaveAccessibleName(
      expect.stringContaining(first.description),
    )
  })

  it('suit le clavier : Tab atteint la première clé, Espace l’accorde, un second Tab passe à la suivante', async () => {
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
