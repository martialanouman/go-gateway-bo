/**
 * La pile de toasts, montée pour de vrai.
 *
 * `toast.test.ts` éprouve la garde d'entrée sans rien rendre ; ici on vérifie le chemin complet —
 * un écran appelle `notify`, le toast apparaît, il porte sa sévérité, et il se ferme.
 *
 * Le cas qui compte est le dernier : **la garde s'applique au moment de l'appel**, pas à
 * l'affichage. Un refus tardif laisserait le toast paraître puis disparaître, et l'invariant (b)
 * aurait été franchi pendant les deux secondes qui comptent.
 */

import { describe, expect, it } from 'vitest'
import { renderComponent } from '~/test/render'
import { Button } from '../primitives'
import { ToastProvider, ToastStack, useToast } from './toast'

function Screen({ onNotify }: { onNotify: () => void }) {
  return (
    <ToastProvider>
      <Trigger onNotify={onNotify} />
      <ToastStack />
    </ToastProvider>
  )
}

function Trigger({ onNotify }: { onNotify: () => void }) {
  const { notify } = useToast()

  return (
    <Button
      onClick={() => {
        onNotify()
        notify({
          title: 'Identifiant renouvelé',
          description: 'L’ancien secret cesse d’être accepté dans 24 heures.',
          severity: 'success',
        })
      }}
    >
      Effectuer la rotation
    </Button>
  )
}

describe('ToastStack', () => {
  it('affiche le toast demandé, avec sa sévérité', async () => {
    const { getByRole, findByText, container, user } = renderComponent(
      <Screen onNotify={() => {}} />,
    )

    await user.click(getByRole('button', { name: 'Effectuer la rotation' }))

    expect(await findByText('Identifiant renouvelé')).toBeInTheDocument()
    // La barre latérale colorée de la charte §10 : elle trie trois toasts empilés d'un coup d'œil,
    // sans porter seule le sens — le titre le dit aussi.
    expect(container.ownerDocument.querySelector('.ui-toast--success')).not.toBeNull()
  })

  it('laisse fermer le toast à la souris', async () => {
    const { getByRole, findByText, getByText, queryByText, user } = renderComponent(
      <Screen onNotify={() => {}} />,
    )

    await user.click(getByRole('button', { name: 'Effectuer la rotation' }))
    await findByText('Identifiant renouvelé')

    // `getByText` et non `getByRole` : **Base UI pose `aria-hidden` sur son bouton de fermeture** —
    // vérifié en remontant la chaîne d'ancêtres dans le DOM rendu. C'est délibéré de leur part : le
    // toast est annoncé d'un bloc, et la fermeture au clavier passe par leur propre parcours plutôt
    // que par une cible de plus dans l'arbre. Ce test couvre donc l'affordance visuelle ; le chemin
    // clavier appartient à la bibliothèque et n'est pas réimplémenté ici.
    await user.click(getByText('Fermer'))
    expect(queryByText('Identifiant renouvelé')).toBeNull()
  })

  it('refuse **avant** d’afficher quand le texte porte une valeur opaque', async () => {
    let refusal: unknown

    function Leaky() {
      const { notify } = useToast()
      return (
        <Button
          onClick={() => {
            // La levée est rattrapée ici plutôt qu'attendue sur la promesse du clic : React relance
            // les erreurs de gestionnaire de façon asynchrone, si bien que `user.click` se résout
            // normalement. Ce que le test doit établir n'est de toute façon pas la levée — elle est
            // couverte dans `toast.test.ts` — mais que **rien n'a été rendu**.
            try {
              notify({ title: 'Secret : sk-live-0123456789abcdef' })
            } catch (error) {
              refusal = error
            }
          }}
        >
          Fuiter
        </Button>
      )
    }

    const { getByRole, queryByText, user } = renderComponent(
      <ToastProvider>
        <Leaky />
        <ToastStack />
      </ToastProvider>,
    )

    await user.click(getByRole('button', { name: 'Fuiter' }))

    expect(refusal).toBeInstanceOf(Error)
    // **Le cœur du test** : la garde est à l'entrée, donc la valeur n'a jamais atteint le DOM. Un
    // refus posé à l'affichage l'aurait laissée paraître le temps d'un cycle de rendu.
    expect(queryByText(/sk-live/)).toBeNull()
  })
})
