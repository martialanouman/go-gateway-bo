import { render, screen, waitFor } from '@testing-library/react'
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
  it('renders a real button, with its label', () => {
    render(<Button>Effectuer la rotation</Button>)

    expect(screen.getByRole('button', { name: 'Effectuer la rotation' })).toBeInTheDocument()
  })

  it('is of type `button` by default', () => {
    // Sans cela, un bouton dans un formulaire le soumet — un « Annuler » qui envoie la requête
    // qu'il prétend abandonner.
    render(<Button>Annuler</Button>)

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('responds to the keyboard as to the mouse', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Réessayer</Button>)

    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('carries the variant as a class — outline and tint, never a solid fill', () => {
    render(<Button variant="danger">Déconnecter la session</Button>)

    expect(screen.getByRole('button')).toHaveClass('ui-button--danger')
  })

  it('calls nothing when disabled', async () => {
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

  it('when busy, does not submit the surrounding form', async () => {
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

  it('submits normally when not busy — the guard does not block everything', async () => {
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

  it('announces itself unavailable while loading, without leaving the keyboard', async () => {
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

  it('when blocked, does not compile without its explanation', () => {
    // La garde est le typecheck : sans l'union de `ButtonProps`, la directive ci-dessous devient
    // inutile et `tsc` rougit. Le rendu, lui, reste bloqué quoi qu'on en fasse.
    // @ts-expect-error — `blocked` exige `aria-describedby`.
    render(<Button blocked>Effectuer la rotation</Button>)

    expect(screen.getByRole('button')).toHaveAttribute('aria-disabled', 'true')
  })

  it('when forbidden, stays visible, reachable and linked to its explanation', async () => {
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

describe('a button forbidden by a reason', () => {
  it('stays in the keyboard path, disabled, and carries its reason as description', () => {
    render(
      <Button blockedReason="Le compte de la session ne se désactive pas ici.">Désactiver</Button>,
    )

    const button = screen.getByRole('button', { name: 'Désactiver' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription('Le compte de la session ne se désactive pas ici.')
  })

  it('keeps the accessible name its caller gives it', () => {
    render(
      <Button aria-label="Révoquer la clé API" blockedReason="Révoquer demande credentials:write.">
        Révoquer
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Révoquer la clé API' })).toHaveAccessibleDescription(
      'Révoquer demande credentials:write.',
    )
  })

  it('shows its reason in a tooltip on keyboard focus, without triggering anything on click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button blockedReason="Réinitialisation sans objet." onClick={onClick}>
        Réinitialiser
      </Button>,
    )

    await user.tab()
    // La bulle n'a pas de rôle `tooltip` : Base UI n'en pose aucun, et la raison est déjà annoncée par
    // `aria-describedby`. Ce qu'on vérifie ici est ce qu'un voyant lit.
    await waitFor(() =>
      expect(document.querySelector('.ui-tooltip')).toHaveTextContent(
        'Réinitialisation sans objet.',
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
