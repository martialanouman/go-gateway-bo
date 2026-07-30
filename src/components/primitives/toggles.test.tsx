/**
 * Les trois bascules : case à cocher, interrupteur, groupe de boutons radio.
 *
 * Ce qu'on vérifie n'est pas qu'elles s'affichent — c'est qu'elles **fonctionnent au clavier** et
 * qu'elles portent le bon rôle. Une case à cocher maison en `<div onClick>` a l'air correcte et
 * n'existe pas pour un lecteur d'écran ; c'est précisément ce que Base UI évite, et ce que ces
 * tests figent.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Checkbox } from './checkbox'
import { RadioGroup } from './radio-group'
import { Switch } from './switch'

describe('Checkbox', () => {
  it('porte le rôle, le libellé, et bascule à la barre d’espace', async () => {
    const onCheckedChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Checkbox label="Masquer les MSISDN" onCheckedChange={onCheckedChange} />,
    )

    const box = getByRole('checkbox', { name: 'Masquer les MSISDN' })
    await user.tab()
    expect(box).toHaveFocus()

    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('rend l’état indéterminé lisible', async () => {
    // La case « tout sélectionner » d'un tableau partiellement coché. Sans `mixed`, elle annonce
    // « non cochée » et ment sur la sélection en cours.
    const { getByRole } = renderComponent(<Checkbox label="Tout sélectionner" indeterminate />)

    expect(getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed')
  })

  it('ne bascule pas quand il est désactivé', async () => {
    const onCheckedChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Checkbox label="Suspendre" disabled onCheckedChange={onCheckedChange} />,
    )

    await user.click(getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

describe('Switch', () => {
  it('porte le rôle `switch` et non `checkbox`', async () => {
    // Les deux se ressemblent et ne se lisent pas pareil : un interrupteur applique son effet
    // immédiatement, une case attend une validation. Le rôle porte cette différence.
    const onCheckedChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Switch label="Facturation activée" onCheckedChange={onCheckedChange} />,
    )

    const toggle = getByRole('switch', { name: 'Facturation activée' })
    await user.click(toggle)

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })
})

describe('RadioGroup', () => {
  const OPTIONS = [
    { value: 'shared', label: 'Pool partagé' },
    { value: 'per_account', label: 'Par compte' },
  ]

  it('n’expose qu’une seule tabulation, puis navigue aux flèches', async () => {
    // Le comportement propre à un groupe radio : une seule entrée dans l'ordre de tabulation, et
    // les flèches parcourent les choix. Le réimplémenter à la main casse ce contrat en silence.
    const onValueChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <RadioGroup
        label="balance_scope"
        options={OPTIONS}
        defaultValue="shared"
        onValueChange={onValueChange}
      />,
    )

    await user.tab()
    expect(getByRole('radio', { name: 'Pool partagé' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(onValueChange).toHaveBeenCalledWith('per_account', expect.anything())
  })

  it('nomme le groupe, pas seulement chaque choix', () => {
    const { getByRole } = renderComponent(<RadioGroup label="balance_scope" options={OPTIONS} />)

    expect(getByRole('radiogroup', { name: 'balance_scope' })).toBeInTheDocument()
  })
})
