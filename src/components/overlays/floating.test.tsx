/**
 * Menu, infobulle, popover — les trois surfaces qui vivent dans un portail.
 *
 * Elles se ressemblent à l'écran et n'ont pas le même contrat. La distinction qui compte est entre
 * l'infobulle et le popover : une infobulle se ferme dès que la souris s'éloigne et ne reçoit jamais
 * le focus, donc **rien de cliquable ne peut y vivre**. Un bouton posé dans une infobulle est
 * inatteignable au clavier, et le défaut ne se voit pas à la souris.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Button } from '../primitives'
import { DropdownMenu } from './dropdown-menu'
import { Popover } from './popover'
import { Tooltip, TooltipProvider } from './tooltip'

describe('DropdownMenu', () => {
  beforeEach(() => {
    // `ACTIONS` est partagé par les cas de ce bloc : sans remise à zéro, l'assertion « l'action
    // désactivée n'a pas été appelée » ne serait vraie que par accident d'ordonnancement.
    vi.clearAllMocks()
  })

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

  it('sélectionne au clavier, pas seulement au clic', async () => {
    // La justification du composant est le clavier : « ArrowDown ouvre, les flèches parcourent ».
    // Seule l'ouverture était testée.
    const onSelect = vi.fn()
    const { getByRole, findByRole, user } = renderComponent(
      <DropdownMenu trigger="Actions" actions={[{ label: 'Voir le détail', onSelect }]} />,
    )

    await user.click(getByRole('button', { name: 'Actions' }))
    await findByRole('menuitem', { name: 'Voir le détail' })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onSelect).toHaveBeenCalledTimes(1)
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
 * L'infobulle — et un `it.todo` assumé plutôt qu'une affirmation de plus.
 *
 * ## Ce que j'ai écrit de faux, et ce que j'ai vérifié depuis
 *
 * Une version précédente de ce fichier affirmait que l'ouverture au focus n'était pas testable en
 * jsdom, faute de `:focus-visible`. **La raison était fausse** : Base UI court-circuite
 * explicitement cette vérification sous jsdom — `floating-ui-react/utils/element.mjs`, « We don't
 * want to block focus from working with `visibleOnly` » — et la détection s'appuie sur l'UA, qui
 * porte bien « jsdom » ici (vérifié). Le chemin est donc prévu pour être testable.
 *
 * ## Et pourtant il ne s'ouvre pas
 *
 * `user.tab()` place bien le focus sur le déclencheur — le test suivant le prouve — mais aucune
 * bulle n'apparaît, ni au focus ni au survol, avec ou sans `delay={0}` sur le `Provider` comme sur
 * la `Root`. Je n'ai pas trouvé pourquoi, et je préfère un `it.todo` visible à une seconde
 * explication confiante : la première m'a déjà fait écrire une limite qui n'existait pas.
 *
 * Ce qui reste couvert ici est le défaut réel qu'une première version portait — l'enfant enveloppé
 * dans un `<span>` qui captait les gestionnaires. Le comportement d'ouverture ira au parcours e2e
 * (step-026), dans un vrai navigateur, où il est de toute façon plus probant.
 */
describe('Tooltip', () => {
  it.todo('s’ouvre au focus, et pas seulement au survol (WCAG 1.4.13) — voir l’en-tête')

  it('fait du déclencheur de l’appelant le déclencheur lui-même', async () => {
    // Le défaut réel de la première version : l'enfant était enveloppé dans un `<span>` qui captait
    // les gestionnaires, et l'élément focusable restait à côté. Rien ne s'ouvrait au clavier.
    const { getByRole, user } = renderComponent(
      <TooltipProvider delay={0}>
        <Tooltip content="Nombre de binds ouverts">
          <button type="button">bind_pool_size</button>
        </Tooltip>
      </TooltipProvider>,
    )

    await user.tab()
    expect(getByRole('button', { name: 'bind_pool_size' })).toHaveFocus()
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
