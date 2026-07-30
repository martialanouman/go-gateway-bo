/**
 * Les modales, et les trois propriétés qu'on ne réécrit pas à la main.
 *
 * Piège de focus, restauration du focus, `Escape`. Chacune se réimplémente mal et le défaut ne se
 * voit qu'au clavier : un piège maison laisse échapper vers la barre d'adresse, une restauration
 * oubliée renvoie l'opérateur en haut de page, un `Escape` absent enferme qui n'a pas de souris.
 *
 * Le test le plus important est le dernier : **l'acte irréversible ne part pas sans confirmation
 * explicite**.
 */

import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { ConfirmDialog } from './confirm-dialog'
import { Dialog } from './dialog'

/** Une modale pilotée, comme un écran la câblerait. */
function Harness({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ouvrir
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Déconnecter la session"
        description="Un unbind gracieux sera envoyé. Le compte devra se reconnecter."
      >
        {children}
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('porte son titre et sa conséquence', async () => {
    const { getByRole, user } = renderComponent(<Harness />)

    await user.click(getByRole('button', { name: 'Ouvrir' }))

    const dialog = getByRole('dialog', { name: 'Déconnecter la session' })
    expect(dialog).toHaveTextContent('Le compte devra se reconnecter.')
  })

  it('se passe de conséquence et de pied quand il n’y a rien à dire de plus', async () => {
    // Une modale minimale reste une modale : titre, piège de focus, Escape. Les parties optionnelles
    // ne doivent pas rendre de conteneur vide, qui laisserait un intervalle inexpliqué.
    function Minimal() {
      const [open, setOpen] = useState(true)
      return <Dialog open={open} onOpenChange={setOpen} title="Confirmer" />
    }

    const { getByRole, container } = renderComponent(<Minimal />)

    expect(getByRole('dialog', { name: 'Confirmer' })).toBeInTheDocument()
    expect(container.ownerDocument.querySelector('.ui-dialog__footer')).toBeNull()
    expect(container.ownerDocument.querySelector('.ui-dialog__body')).toBeNull()
  })

  it('rend un pied d’actions quand on lui en donne un', async () => {
    function WithFooter() {
      const [open, setOpen] = useState(true)
      return (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Confirmer"
          footer={<button type="button">Fermer</button>}
        />
      )
    }

    const { getByRole } = renderComponent(<WithFooter />)

    expect(getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })

  it('se ferme à Escape', async () => {
    const { getByRole, queryByRole, user } = renderComponent(<Harness />)

    await user.click(getByRole('button', { name: 'Ouvrir' }))
    expect(getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(queryByRole('dialog')).toBeNull()
  })

  it('rend le focus à ce qui l’a ouverte', async () => {
    // Sans restauration, l'opérateur repart en haut de page et doit refaire tout son chemin au
    // clavier — sur un écran dense, c'est plusieurs dizaines de tabulations.
    const { getByRole, user } = renderComponent(<Harness />)

    const trigger = getByRole('button', { name: 'Ouvrir' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
  })

  it('retire le reste de la page aux technologies d’assistance', async () => {
    // Écrit d'abord comme « une tabulation ne revient pas au déclencheur », le test échouait — pour
    // une meilleure raison que prévu : Base UI rend le contenu extérieur **inerte** tant que la
    // modale est ouverte, si bien que le déclencheur n'est même plus dans l'arbre d'accessibilité.
    // C'est plus fort qu'un piège de focus, et c'est ce qu'une modale doit faire : sans cela, un
    // lecteur d'écran continue de parcourir la page derrière la boîte.
    const { getByRole, queryByRole, getByLabelText, user } = renderComponent(
      <Harness>
        <label htmlFor="raison">Raison</label>
        <input id="raison" />
      </Harness>,
    )

    await user.click(getByRole('button', { name: 'Ouvrir' }))

    expect(getByRole('dialog')).toBeInTheDocument()
    expect(getByLabelText('Raison')).toBeInTheDocument()
    // Le déclencheur vit **hors** de la modale : il doit disparaître de l'arbre.
    expect(queryByRole('button', { name: 'Ouvrir' })).toBeNull()

    // Et il revient quand la modale se ferme.
    await user.keyboard('{Escape}')
    expect(getByRole('button', { name: 'Ouvrir' })).toBeInTheDocument()
  })
})

describe('ConfirmDialog', () => {
  const CONSEQUENCE = 'Les métadonnées sont conservées, le corps devient illisible. Irréversible.'

  function ConfirmHarness({
    onConfirm,
    confirmationPhrase,
  }: {
    onConfirm: () => void
    confirmationPhrase?: string
  }) {
    const [open, setOpen] = useState(true)

    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Détruire la clé de contenu"
        consequence={CONSEQUENCE}
        confirmLabel="Détruire la clé"
        confirmationPhrase={confirmationPhrase}
        onConfirm={onConfirm}
      />
    )
  }

  it('nomme l’acte dans son bouton, jamais « OK »', () => {
    const { getByRole, queryByRole } = renderComponent(<ConfirmHarness onConfirm={vi.fn()} />)

    expect(getByRole('button', { name: 'Détruire la clé' })).toBeInTheDocument()
    expect(queryByRole('button', { name: 'OK' })).toBeNull()
  })

  it('affiche la conséquence en clair', () => {
    const { getByRole } = renderComponent(<ConfirmHarness onConfirm={vi.fn()} />)

    expect(getByRole('dialog')).toHaveTextContent(CONSEQUENCE)
  })

  it('agit au clic quand l’acte est réversible', async () => {
    const onConfirm = vi.fn()
    const { getByRole, user } = renderComponent(<ConfirmHarness onConfirm={onConfirm} />)

    await user.click(getByRole('button', { name: 'Détruire la clé' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('**ne part pas sans confirmation explicite** quand l’acte est irréversible', async () => {
    // Le test central de la step. Le bouton doit rester inerte tant que la phrase n'est pas
    // recopiée : c'est ce qui distingue un clic de trop d'une décision.
    const onConfirm = vi.fn()
    const { getByRole, user } = renderComponent(
      <ConfirmHarness onConfirm={onConfirm} confirmationPhrase="DETRUIRE" />,
    )

    const confirm = getByRole('button', { name: 'Détruire la clé' })
    await user.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    // Une phrase approchante ne suffit pas non plus.
    await user.type(getByRole('textbox'), 'detruire')
    await user.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    await user.clear(getByRole('textbox'))
    await user.type(getByRole('textbox'), 'DETRUIRE')
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('redemande la phrase après une fermeture — la friction ne vaut pas qu’une fois', async () => {
    // Sans remise à zéro, rouvrir la boîte présenterait un bouton déjà armé : la friction n'aurait
    // protégé que la première tentative, c'est-à-dire celle où l'opérateur était le plus attentif.
    const onConfirm = vi.fn()

    function Reopenable() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Rouvrir
          </button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Détruire la clé de contenu"
            consequence={CONSEQUENCE}
            confirmLabel="Détruire la clé"
            confirmationPhrase="DETRUIRE"
            onConfirm={onConfirm}
          />
        </>
      )
    }

    const { getByRole, user } = renderComponent(<Reopenable />)

    await user.type(getByRole('textbox'), 'DETRUIRE')
    await user.click(getByRole('button', { name: 'Annuler' }))
    await user.click(getByRole('button', { name: 'Rouvrir' }))

    expect(getByRole('textbox')).toHaveValue('')
    await user.click(getByRole('button', { name: 'Détruire la clé' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('n’est pas destructif quand l’acte ne l’est pas', () => {
    const { getByRole } = renderComponent(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Publier la version 4"
        consequence="La version 4 devient active immédiatement sur le routage."
        confirmLabel="Publier"
        destructive={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(getByRole('button', { name: 'Publier' })).toHaveClass('ui-button--primary')
  })

  it('annule sans agir', async () => {
    const onConfirm = vi.fn()
    const { getByRole, queryByRole, user } = renderComponent(
      <ConfirmHarness onConfirm={onConfirm} confirmationPhrase="DETRUIRE" />,
    )

    await user.click(getByRole('button', { name: 'Annuler' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(queryByRole('dialog')).toBeNull()
  })
})
