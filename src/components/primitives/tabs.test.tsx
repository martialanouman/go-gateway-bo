/**
 * Les onglets, et le contrat clavier que la WCAG attend d'eux.
 *
 * Un `role="tablist"` promet un comportement précis : les flèches déplacent la sélection, `Tab`
 * saute directement au panneau. Une réimplémentation en boutons ordinaires annonce le rôle sans
 * tenir la promesse — le pire des deux mondes, puisque l'utilisateur au clavier fait confiance à
 * l'annonce.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Tabs } from './tabs'

const TABS = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'binds', label: 'Binds', count: 12 },
  { value: 'quotas', label: 'Quotas', disabled: true },
]

describe('Tabs', () => {
  it('rend une liste d’onglets et marque le sélectionné', () => {
    const { getByRole } = renderComponent(<Tabs tabs={TABS} defaultValue="sessions" />)

    expect(getByRole('tablist')).toBeInTheDocument()
    expect(getByRole('tab', { name: /Sessions/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('déplace le focus aux flèches **sans** activer, puis active à Entrée', async () => {
    // Activation **manuelle**, et c'est un choix de produit : chaque onglet de ce tableau de bord
    // déclenche un appel à l'API Admin. En activation automatique, parcourir trois onglets au
    // clavier lancerait trois chargements dont deux que personne n'a demandés. La WAI-ARIA laisse
    // les deux ouverts et recommande le manuel quand le panneau coûte cher — c'est notre cas.
    const onValueChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Tabs tabs={TABS} defaultValue="sessions" onValueChange={onValueChange} />,
    )

    await user.tab()
    await user.keyboard('{ArrowRight}')

    expect(getByRole('tab', { name: /Binds/ })).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('binds', expect.anything())
  })

  it('affiche le compteur quand il est connu', () => {
    const { getByRole } = renderComponent(<Tabs tabs={TABS} defaultValue="sessions" />)

    expect(getByRole('tab', { name: /Binds/ })).toHaveTextContent('12')
  })

  it('n’active jamais un onglet désactivé', async () => {
    const onValueChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Tabs tabs={TABS} defaultValue="binds" onValueChange={onValueChange} />,
    )

    await user.click(getByRole('tab', { name: /Quotas/ }))

    expect(onValueChange).not.toHaveBeenCalled()
  })
})
