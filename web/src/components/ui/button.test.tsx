import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

/**
 * Le bouton, et les deux règles qu'il porte.
 *
 * **Contour et teinte, jamais un aplat** — règle visuelle, donc vérifiée sur la classe rendue et
 * non sur des pixels ; c'est la feuille qui la tient, et `/_design` qui la montre.
 *
 * **Un contrôle indisponible reste annoncé.** Occupé ou interdit, il garde sa place dans le
 * parcours clavier : un `disabled` nu déplace le focus sans prévenir et retire l'élément de l'arbre
 * d'accessibilité, au moment précis où l'opérateur attend une nouvelle.
 */
describe('Button', () => {
  it('rend un vrai bouton, avec son libellé', () => {
    render(<Button>Effectuer la rotation</Button>)

    expect(screen.getByRole('button', { name: 'Effectuer la rotation' })).toBeInTheDocument()
  })

  it('est de type `button` par défaut', () => {
    // Sans cela, un bouton dans un formulaire le soumet — un « Annuler » qui envoie la requête
    // qu'il prétend abandonner.
    render(<Button>Annuler</Button>)

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('répond au clavier comme à la souris', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Réessayer</Button>)

    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('porte la variante en classe — contour et teinte, jamais un aplat', () => {
    render(<Button variant="danger">Déconnecter la session</Button>)

    expect(screen.getByRole('button')).toHaveClass('ui-button--danger')
  })

  it('n’appelle rien quand il est désactivé', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Lever le désabonnement
      </Button>,
    )

    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('occupé, il ne soumet pas le formulaire qui l’entoure', async () => {
    // Neutraliser `onClick` ne couvre que le chemin React : un `type="submit"` soumettait quand
    // même, par le clic comme par Entrée. Sur un écran de rotation de secret, cela valait une
    // seconde rotation et une seconde ligne d'audit.
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Effectuer la rotation
        </Button>
      </form>,
    )

    await user.click(screen.getByRole('button'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('soumet normalement quand il n’est pas occupé — la garde ne bloque pas tout', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Effectuer la rotation</Button>
      </form>,
    )

    await user.click(screen.getByRole('button'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('s’annonce indisponible pendant le chargement, sans quitter le clavier', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Lancer le job
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Lancer le job' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    // `aria-busy` seul n'est annoncé par aucun des trois lecteurs d'écran majeurs sur un bouton :
    // l'opérateur entendait « bouton », pressait Entrée, et n'obtenait ni action ni explication.
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('interdit, il reste visible, atteignable et relié à son explication', async () => {
    // « Un contrôle interdit est désactivé **et expliqué**, jamais silencieusement masqué. » Le
    // masquer laisse l'opérateur chercher un bouton qui n'apparaît pas ; un `disabled` nu le retire
    // de l'arbre d'accessibilité, et celui qui écoute ne sait ni qu'il existe ni ce qui le
    // débloquerait. La primitive porte le mécanisme ; l'écran écrit le pourquoi.
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <>
        <Button blocked aria-describedby="refus" onClick={onClick}>
          Effectuer la rotation
        </Button>
        <p id="refus">Cette action demande la permission credentials:rotate.</p>
      </>,
    )

    const button = screen.getByRole('button', {
      name: 'Effectuer la rotation',
      description: 'Cette action demande la permission credentials:rotate.',
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await user.tab()
    expect(button).toHaveFocus()

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
