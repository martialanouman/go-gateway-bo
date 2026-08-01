/**
 * Le bouton, et les deux règles de la charte qu'il porte.
 *
 * **Contour et teinte, jamais un aplat.** La charte l'écrit pour le cas destructif — « toujours en
 * contour, jamais plein » — et les spécimens montrent la même chose pour le primaire. C'est une
 * règle visuelle, donc vérifiée sur la classe rendue et non sur des pixels.
 *
 * **Un bouton occupé reste annoncé.** Un `disabled` nu retire l'élément du parcours clavier et le
 * lecteur d'écran perd le fil ; `aria-busy` dit ce qui se passe.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Button } from './button'

describe('Button', () => {
  it('rend un vrai bouton, avec son libellé', () => {
    const { getByRole } = renderComponent(<Button>Effectuer la rotation</Button>)

    expect(getByRole('button', { name: 'Effectuer la rotation' })).toBeInTheDocument()
  })

  it('est de type `button` par défaut', () => {
    // Sans cela, un bouton dans un formulaire le soumet — un « Annuler » qui envoie la requête.
    const { getByRole } = renderComponent(<Button>Annuler</Button>)

    expect(getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('répond au clavier comme à la souris', async () => {
    const onClick = vi.fn()
    const { getByRole, user } = renderComponent(<Button onClick={onClick}>Réessayer</Button>)

    await user.tab()
    expect(getByRole('button')).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('porte la variante en classe — contour et teinte, jamais un aplat', () => {
    const { getByRole } = renderComponent(<Button variant="destructive">Déconnecter</Button>)

    expect(getByRole('button')).toHaveClass('ui-button--destructive')
  })

  it('n’appelle rien quand il est désactivé', async () => {
    const onClick = vi.fn()
    const { getByRole, user } = renderComponent(
      <Button disabled onClick={onClick}>
        Lever le désabonnement
      </Button>,
    )

    await user.click(getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('occupé, il ne soumet pas le formulaire qui l’entoure', async () => {
    // **Le test qui manquait, et le bug qu'il a révélé.** Neutraliser `onClick` ne couvre que le
    // chemin React : un `type="submit"` soumettait quand même, par le clic comme par Entrée. Sur un
    // écran de rotation de secret, cela valait une seconde rotation et une seconde ligne d'audit.
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const { getByRole, user } = renderComponent(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Effectuer la rotation
        </Button>
      </form>,
    )

    await user.click(getByRole('button'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('soumet normalement quand il n’est pas occupé — la garde ne doit pas tout bloquer', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const { getByRole, user } = renderComponent(
      <form onSubmit={onSubmit}>
        <Button type="submit">Effectuer la rotation</Button>
      </form>,
    )

    await user.click(getByRole('button'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('s’annonce indisponible pendant le chargement, sans quitter le clavier', async () => {
    const onClick = vi.fn()
    const { getByRole, user } = renderComponent(
      <Button loading onClick={onClick}>
        Lancer le job
      </Button>,
    )

    const button = getByRole('button', { name: 'Lancer le job' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    // `aria-busy` seul n'est annoncé par aucun lecteur d'écran majeur sur un bouton : l'opérateur
    // entendait « bouton », pressait Entrée, et n'obtenait ni action ni explication.
    expect(button).toHaveAttribute('aria-disabled', 'true')

    // Occupé veut dire « ne repartez pas » : le second clic ne doit pas relancer le job.
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
