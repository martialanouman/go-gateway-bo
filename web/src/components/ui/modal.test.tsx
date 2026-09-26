import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './modal'

/**
 * Ce que ce fichier garde n'est pas une apparence mais quatre comportements qu'une réécriture maison
 * casse sans bruit : le nom accessible, la fermeture par `Échap`, le démontage à la fermeture, et
 * l'inertie de ce qu'il y a derrière.
 *
 * **Le piège du focus lui-même se vérifie ailleurs** — dans le parcours Playwright. jsdom n'a ni
 * ordre de tabulation réel, ni `inert`, ni visibilité calculée : y « vérifier » un piège de focus
 * donnerait un test vert qui ne prouve rien. Ce qui est observable ici, c'est que l'extérieur **sort
 * de l'arbre d'accessibilité** : chercher un `aria-hidden` sur un ancêtre ne marcherait pas, le
 * bouton extérieur n'ayant plus de rôle à interroger.
 */
describe('Modal', () => {
  it('takes its accessible name from its title', () => {
    render(
      <Modal onClose={() => {}} open title="Déconnecter la session ?">
        Un unbind gracieux sera envoyé.
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Déconnecter la session ?' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    // Une modale dont on ne sort qu'au clic est un piège pour qui navigue au clavier. Aucun filtre
    // sur la raison de la fermeture n'est posé dans le composant, et c'est délibéré : en ajouter un
    // rouvrirait exactement ce défaut.
    const close = vi.fn()
    render(
      <Modal onClose={close} open title="Rotation de la clé API">
        Corps
      </Modal>,
    )

    await userEvent.keyboard('{Escape}')

    expect(close).toHaveBeenCalledOnce()
  })

  it('closes via the close button, which stays inside the modal', async () => {
    // Base UI l'exige en mode modal : « render `<Dialog.Close>` inside `<Dialog.Popup>` so touch
    // screen readers can escape the popup ». Hors du popup, un lecteur d'écran tactile ne l'atteint
    // jamais.
    const close = vi.fn()
    render(
      <Modal onClose={close} open title="Rotation de la clé API">
        Corps
      </Modal>,
    )

    const fermer = screen.getByRole('button', { name: 'Fermer' })
    expect(fermer.closest('[role="dialog"]')).not.toBeNull()

    await userEvent.click(fermer)

    expect(close).toHaveBeenCalledOnce()
  })

  /**
   * **L'invariant (b), six steps avant l'écran qui en dépend.**
   *
   * M3 exigera que « après fermeture de la modale, le secret soit introuvable dans le DOM ». Un
   * `Dialog.Portal keepMounted` laisserait le contenu dans le document, simplement masqué : la
   * modale paraîtrait fermée et la chaîne serait encore là, à portée d'un `Ctrl+F` comme d'une
   * extension. Le composant est monté sans, et ce test est ce qui le tient.
   */
  it('leaves none of its content in the document once closed', () => {
    const secret = 'sk_live_9f2ac4d1'
    const { rerender } = render(
      <Modal onClose={() => {}} open title="Rotation de la clé API">
        {secret}
      </Modal>,
    )
    expect(screen.getByText(secret)).toBeInTheDocument()

    rerender(
      <Modal onClose={() => {}} open={false} title="Rotation de la clé API">
        {secret}
      </Modal>,
    )

    expect(screen.queryByText(secret)).toBeNull()
    expect(document.body.textContent).not.toContain(secret)
  })

  /**
   * **Le compagnon jsdom du piège de focus.**
   *
   * Le piège lui-même n'est observable qu'en Chromium — le parcours s'en charge. Ce qui se mesure
   * ici, c'est sa moitié visible aux outils d'assistance : en mode modal, Base UI retire l'extérieur
   * de l'arbre d'accessibilité. Un lecteur d'écran qui continuerait d'y circuler sortirait de la
   * modale sans que rien ne le dise.
   *
   * Les deux moitiés du test comptent. Sans la seconde — le même bouton retrouvé une fois la modale
   * fermée — la première passerait aussi sur un bouton qui n'aurait jamais existé.
   */
  it('removes what lies behind it from the accessibility tree', () => {
    const derriere = <button type="button">Derrière</button>

    const { rerender } = render(
      <div>
        {derriere}
        <Modal onClose={() => {}} open title="Déconnecter la session ?">
          Corps
        </Modal>
      </div>,
    )
    expect(screen.queryByRole('button', { name: 'Derrière' })).toBeNull()

    rerender(
      <div>
        {derriere}
        <Modal onClose={() => {}} open={false} title="Déconnecter la session ?">
          Corps
        </Modal>
      </div>,
    )
    expect(screen.getByRole('button', { name: 'Derrière' })).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    render(
      <Modal onClose={() => {}} open={false} title="Déconnecter la session ?">
        Corps
      </Modal>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('carries its actions and header when the screen provides them', () => {
    render(
      <Modal
        footer={<button type="button">Déconnecter</button>}
        icon={<span data-testid="pastille" />}
        onClose={() => {}}
        open
        title="Déconnecter la session ?"
        wide
      >
        Corps
      </Modal>,
    )

    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeInTheDocument()
    expect(screen.getByTestId('pastille')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('ui-modal--wide')
  })
})
