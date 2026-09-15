import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, ModuleDisabled, NoResults } from './content-state'

/**
 * Les cinq copies sont distinctes, et c'est tout l'objet de ce fichier.
 *
 * « Empty ≠ error ≠ disabled » : deux états qui se ressemblent à l'écran sont un défaut, pas une
 * économie. Le bloc qui compte est le dernier — il tient la seule distinction que le serveur a déjà
 * refusé de faire (`internal/gateway/errors_test.go`, DN-8) et que la moitié cliente doit dire de la
 * même façon.
 */
describe('EmptyState', () => {
  it('dit pourquoi la région est vide, et par où commencer', () => {
    render(
      <EmptyState
        action={<button type="button">Nouvelle règle</button>}
        title="Aucune règle d’alerte"
        description="Créez une règle pour être notifié des incidents."
      />,
    )

    expect(screen.getByText('Aucune règle d’alerte')).toBeInTheDocument()
    expect(screen.getByText('Créez une règle pour être notifié des incidents.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nouvelle règle' })).toBeInTheDocument()
  })

  it('rend son titre en paragraphe par défaut, et en titre quand l’écran le demande', () => {
    // Le défaut compte autant que l'option : un état vide rendu dans une carte, au milieu d'un
    // écran qui a déjà son `h1`, n'a rien à faire dans la hiérarchie de titres. Mais quand il **est**
    // l'écran — l'accueil, l'adresse inconnue — il en est le titre, et un écran sans `h1` est une
    // page que les lecteurs d'écran ne savent pas annoncer.
    const { unmount } = render(<EmptyState title="Rien encore" />)
    expect(screen.queryByRole('heading')).toBeNull()
    unmount()

    render(<EmptyState titleAs="h1" title="Rien encore" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rien encore')
  })
})

describe('NoResults', () => {
  it('nomme les filtres et propose de les élargir — jamais un « aucun résultat » nu', () => {
    render(<NoResults title="Aucun message trouvé" />)

    expect(screen.getByText('Aucun message trouvé')).toBeInTheDocument()
    expect(
      screen.getByText('Élargissez la plage de dates ou retirez un filtre.'),
    ).toBeInTheDocument()
  })

  it('n’offre le bouton de réinitialisation qu’à l’écran qui sait le faire', () => {
    const reset = vi.fn()
    const { unmount } = render(<NoResults title="Aucun message trouvé" />)
    expect(screen.queryByRole('button')).toBeNull()
    unmount()

    render(<NoResults onReset={reset} title="Aucun message trouvé" />)
    expect(screen.getByRole('button', { name: 'Réinitialiser' })).toBeInTheDocument()
  })

  it('réinitialise les filtres au clic', async () => {
    const reset = vi.fn()
    render(<NoResults onReset={reset} title="Aucun message trouvé" />)

    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }))

    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('ModuleDisabled', () => {
  it('nomme le module éteint et le déploiement qui l’éteint', () => {
    render(<ModuleDisabled module="Facturation" />)

    expect(screen.getByText('Facturation indisponible')).toBeInTheDocument()
  })

  /**
   * **La mutation que la fiche exige.** Rendre `ModuleDisabled` avec la copie — ou le balisage — de
   * `ErrorState` doit faire rougir ici.
   *
   * Les quatre assertions sont un tout : asserter le seul titre laisserait la mutation verte, parce
   * que « Facturation indisponible » survit à la confusion. Ce qui ne survit pas, c'est la
   * **conséquence** — un module éteint n'alerte pas, n'invite à rien, et n'emprunte pas le panneau
   * rouge. Un `Réessayer` sur quelque chose qui ne reviendra pas envoie l'opérateur cliquer dans le
   * vide ; c'est précisément ce que `TestServiceUnavailableStaysAnError` refuse côté serveur.
   */
  it('ne se lit jamais comme une erreur : ni alerte, ni action, ni panneau rouge', () => {
    const { container } = render(<ModuleDisabled module="Facturation" />)

    expect(
      screen.getByText(
        'Module désactivé sur la passerelle. Dégradation propre — jamais une erreur.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelector('.ui-empty')).not.toBeNull()
    expect(container.querySelector('.ui-error')).toBeNull()
  })
})

describe('ErrorState', () => {
  it('porte la réalité HTTP, promet les données locales, et propose de réessayer', () => {
    // La copie de la charte nomme jusqu'à la requête. Effacer l'écran pour afficher une erreur est
    // le contraire de ce que demande l'invariant (e) : la panne du tableau de bord dégrade la
    // visualisation, elle ne la supprime pas.
    render(
      <ErrorState
        onRetry={() => {}}
        request="GET /api/connectors · 504 · req_8f2c…"
        description="La passerelle n’a pas répondu (504). Vos données locales restent affichées."
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Impossible de joindre l’API Admin')).toBeInTheDocument()
    expect(screen.getByText(/Vos données locales restent affichées/)).toBeInTheDocument()
    expect(screen.getByText('GET /api/connectors · 504 · req_8f2c…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('réessaie au clic', async () => {
    const retry = vi.fn()
    render(<ErrorState onRetry={retry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(retry).toHaveBeenCalledOnce()
  })

  it('se passe de ligne de requête et de réessai quand l’écran n’en a pas', () => {
    // Un `ErrorState` sans `request` ne doit pas rendre une ligne mono vide, qui se lirait comme une
    // trace perdue.
    const { container } = render(<ErrorState />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.ui-error__request')).toBeNull()
  })
})
