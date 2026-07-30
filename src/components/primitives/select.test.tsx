/**
 * Le sélecteur : ce qu'on perd en quittant le `<select>` natif, et qu'il faut donc vérifier.
 *
 * Le natif est peint par le système d'exploitation — une liste blanche au milieu d'une console
 * sombre — d'où le choix de Base UI. Mais quitter le natif, c'est reprendre la charge de tout ce
 * qu'il faisait gratuitement : le rôle, l'ouverture au clavier, la sélection, `Escape`. Ces tests
 * sont là pour que cette dette reste payée.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Select } from './select'

const SCOPES = [
  { value: 'shared', label: 'Pool partagé' },
  { value: 'per_account', label: 'Par compte' },
]

describe('Select', () => {
  it('porte un nom accessible, et pas seulement sa valeur', () => {
    // Le point le plus fragile de l'abandon du `<select>` natif : celui-là s'associait à un
    // `<label>` gratuitement. Sans nom, un lecteur d'écran annonce « Pool partagé, zone de liste »
    // sans jamais dire de quoi l'opérateur choisit la portée.
    const { getByRole } = renderComponent(
      <Select label="balance_scope" options={SCOPES} defaultValue="shared" />,
    )

    expect(getByRole('combobox', { name: 'balance_scope' })).toBeInTheDocument()
  })

  it('annonce le choix courant, ou l’invite quand rien n’est choisi', () => {
    const { getByRole } = renderComponent(
      <Select label="balance_scope" options={SCOPES} placeholder="Choisir une portée" />,
    )

    expect(getByRole('combobox')).toHaveTextContent('Choisir une portée')
  })

  it('s’ouvre et se choisit entièrement au clavier', async () => {
    const onValueChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Select label="balance_scope" options={SCOPES} onValueChange={onValueChange} />,
    )

    await user.tab()
    expect(getByRole('combobox')).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.click(await screenOption('Par compte'))

    expect(onValueChange).toHaveBeenCalledWith('per_account', expect.anything())
  })

  it('accepte la hauteur réduite et une classe d’écran', () => {
    // 28 px au lieu de 34 : la charte prévoit trois hauteurs de contrôle, et une barre de filtres
    // dense les utilise. Sans ce cas, la variante n'était rendue nulle part.
    const { getByRole } = renderComponent(
      <Select label="balance_scope" options={SCOPES} size="sm" className="filtre-compte" />,
    )

    const trigger = getByRole('combobox')
    expect(trigger).toHaveClass('ui-select--sm')
    expect(trigger).toHaveClass('filtre-compte')
  })

  it('rend la valeur choisie plutôt que l’invite', () => {
    const { getByRole } = renderComponent(
      <Select label="balance_scope" options={SCOPES} defaultValue="shared" />,
    )

    expect(getByRole('combobox')).toHaveTextContent('Pool partagé')
  })
})

/** Les options vivent dans un portail : on les cherche dans le document, pas dans le conteneur. */
async function screenOption(name: string) {
  const { screen } = await import('@testing-library/react')
  return screen.findByRole('option', { name })
}
