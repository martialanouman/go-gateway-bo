/**
 * Menu, infobulle, popover — les trois surfaces qui vivent dans un portail.
 *
 * Elles se ressemblent à l'écran et n'ont pas le même contrat. La distinction qui compte est entre
 * l'infobulle et le popover : une infobulle se ferme dès que la souris s'éloigne et ne reçoit jamais
 * le focus, donc **rien de cliquable ne peut y vivre**. Un bouton posé dans une infobulle est
 * inatteignable au clavier, et le défaut ne se voit pas à la souris.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Button } from '../primitives'
import { DropdownMenu } from './dropdown-menu'
import { Popover } from './popover'
import { Tooltip, TooltipProvider } from './tooltip'

describe('DropdownMenu', () => {
  const ACTIONS = [
    { label: 'Voir le détail', onSelect: vi.fn() },
    { label: 'Forcer le rebind', onSelect: vi.fn(), disabled: true },
    { label: 'Déconnecter', onSelect: vi.fn(), destructive: true },
  ]

  it('s’ouvre au clavier et rend ses actions', async () => {
    const { getByRole, findByRole, user } = renderComponent(
      <DropdownMenu trigger="Actions" actions={ACTIONS} />,
    )

    await user.tab()
    expect(getByRole('button', { name: 'Actions' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(await findByRole('menuitem', { name: 'Voir le détail' })).toBeInTheDocument()
  })

  it('déclenche l’action choisie', async () => {
    const onSelect = vi.fn()
    const { getByRole, findByRole, user } = renderComponent(
      <DropdownMenu trigger="Actions" actions={[{ label: 'Voir le détail', onSelect }]} />,
    )

    await user.click(getByRole('button', { name: 'Actions' }))
    await user.click(await findByRole('menuitem', { name: 'Voir le détail' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('marque l’action destructive sans changer son comportement', async () => {
    // Elle se **lit** différemment. Sur une liste de six actions, c'est ce qui empêche
    // « Déconnecter » d'être cliqué à la place de « Détails ».
    const { getByRole, findByRole, user } = renderComponent(
      <DropdownMenu trigger="Actions" actions={ACTIONS} />,
    )

    await user.click(getByRole('button', { name: 'Actions' }))

    expect(await findByRole('menuitem', { name: 'Déconnecter' })).toHaveClass(
      'ui-menu__item--destructive',
    )
  })

  it('n’active pas une action désactivée', async () => {
    const { getByRole, findByRole, user } = renderComponent(
      <DropdownMenu trigger="Actions" actions={ACTIONS} />,
    )

    await user.click(getByRole('button', { name: 'Actions' }))
    await user.click(await findByRole('menuitem', { name: 'Forcer le rebind' }))

    expect(ACTIONS[1]?.onSelect).not.toHaveBeenCalled()
  })
})

/**
 * L'infobulle — **ce que jsdom ne peut pas vérifier, et pourquoi c'est écrit ici**.
 *
 * Son ouverture dépend de sémantiques de pointeur et de `:focus-visible` que jsdom n'implémente pas :
 * ni le survol ni la tabulation ne la font apparaître dans cet environnement. Écrire un test qui
 * l'affirme aurait produit un vert sans contenu — le mode d'échec que ce dépôt traque partout
 * ailleurs.
 *
 * Ce qui est vérifiable ici est le **défaut réel** qu'une première version portait : le composant
 * enveloppait son enfant dans un `<span>`, si bien que le `<span>` recevait les gestionnaires et que
 * l'élément focusable de l'appelant restait à côté. L'infobulle ne répondait alors qu'à la souris,
 * ce que la WCAG 1.4.13 interdit. La composition est donc testée ; l'ouverture appartient à la
 * bibliothèque et sera couverte par un parcours e2e dans un vrai navigateur (step-026).
 */
describe('Tooltip', () => {
  it('fait du déclencheur de l’appelant le déclencheur lui-même', async () => {
    const { getByRole, user } = renderComponent(
      <TooltipProvider delay={0}>
        <Tooltip content="Nombre de binds ouverts sur ce connecteur">
          <button type="button">bind_pool_size</button>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = getByRole('button', { name: 'bind_pool_size' })

    // Un seul élément, pas un `<span>` autour d'un bouton : l'élément focusable **est** celui que
    // Base UI instrumente.
    await user.tab()
    expect(trigger).toHaveFocus()
    expect(trigger.parentElement?.tagName).not.toBe('SPAN')
  })
})

describe('Popover', () => {
  it('porte du contenu interactif, ce qu’une infobulle ne peut pas faire', async () => {
    // La raison d'être du composant : dès qu'un panneau flottant contient un bouton ou un champ,
    // c'est un popover — sinon son contenu est inatteignable au clavier.
    const onApply = vi.fn()
    const { getByRole, findByRole, user } = renderComponent(
      <Popover trigger="Filtres" title="Affiner la période">
        <Button onClick={onApply}>Appliquer</Button>
      </Popover>,
    )

    await user.click(getByRole('button', { name: 'Filtres' }))

    const apply = await findByRole('button', { name: 'Appliquer' })
    await user.click(apply)

    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('se passe de titre quand le panneau se suffit', async () => {
    const { getByRole, findByRole, user } = renderComponent(
      <Popover trigger="Filtres">
        <Button onClick={() => {}}>Appliquer</Button>
      </Popover>,
    )

    await user.click(getByRole('button', { name: 'Filtres' }))
    expect(await findByRole('button', { name: 'Appliquer' })).toBeInTheDocument()
  })
})
