/**
 * Le sélecteur : ce qu'on perd en quittant le `<select>` natif, et qu'il faut donc vérifier.
 *
 * Le natif est peint par le système d'exploitation — une liste blanche au milieu d'une console
 * sombre — d'où le choix de Base UI. Mais quitter le natif, c'est reprendre la charge de tout ce
 * qu'il faisait gratuitement : le rôle, l'ouverture au clavier, la sélection, `Escape`. Ces tests
 * sont là pour que cette dette reste payée.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Select } from './select'

const SCOPES = [
  { value: 'shared', label: 'Pool partagé' },
  { value: 'per_account', label: 'Par compte' },
]

describe('Select', () => {
  it('carries an accessible name, not just its value', () => {
    // Le point le plus fragile de l'abandon du `<select>` natif : celui-là s'associait à un
    // `<label>` gratuitement. Sans nom, un lecteur d'écran annonce « Pool partagé, zone de liste »
    // sans jamais dire de quoi l'opérateur choisit la portée.
    render(<Select label="balance_scope" options={SCOPES} defaultValue="shared" />)

    expect(screen.getByRole('combobox', { name: 'balance_scope' })).toBeInTheDocument()
  })

  it('announces the current choice, or the placeholder when nothing is chosen', () => {
    render(<Select label="balance_scope" options={SCOPES} placeholder="Choisir une portée" />)

    expect(screen.getByRole('combobox')).toHaveTextContent('Choisir une portée')
  })

  it('opens and is chosen entirely with the keyboard', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(<Select label="balance_scope" options={SCOPES} onValueChange={onValueChange} />)

    await user.tab()
    expect(screen.getByRole('combobox')).toHaveFocus()

    await user.keyboard('{Enter}')
    // Ouverte par Entrée, la liste met en évidence la première option : une flèche mène à la seconde.
    await screenOption('Par compte')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onValueChange).toHaveBeenCalledWith('per_account', expect.anything())
  })

  it('accepts the reduced height and a screen class', () => {
    // 28 px au lieu de 34 : la charte prévoit trois hauteurs de contrôle, et une barre de filtres
    // dense les utilise. Sans ce cas, la variante n'était rendue nulle part.
    render(<Select label="balance_scope" options={SCOPES} size="sm" className="filtre-compte" />)

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveClass('ui-select--sm')
    expect(trigger).toHaveClass('filtre-compte')
  })

  it('renders the chosen value rather than the placeholder', () => {
    render(<Select label="balance_scope" options={SCOPES} defaultValue="shared" />)

    expect(screen.getByRole('combobox')).toHaveTextContent('Pool partagé')
  })
})

/** Les options vivent dans un portail : on les cherche dans le document, pas dans le conteneur. */
async function screenOption(name: string) {
  const { screen } = await import('@testing-library/react')
  return screen.findByRole('option', { name })
}
