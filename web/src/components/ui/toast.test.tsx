import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from './button'
import { TOAST_TIMEOUT, type ToastSeverity, type ToastSource, ToastStack, useToast } from './toast'

/**
 * Ce que ces tests tiennent : la **source** dit lequel des deux étages a détecté, le plafond
 * plafonne réellement, et un toast reste fermable.
 *
 * La source n'est pas une décoration. Alertmanager évalue indépendamment de la disponibilité du
 * tableau de bord, le BFF évalue sur une source durable — et les deux ne se réparent pas pareil.
 * Rendre l'un pour l'autre envoie l'opérateur au mauvais runbook.
 */

/** Un écran de démonstration : la pile, et de quoi la remplir depuis le parcours du test. */
function Ecran({
  toasts,
}: {
  readonly toasts: readonly {
    readonly title: string
    readonly description?: string
    readonly severity?: ToastSeverity
    readonly source?: ToastSource
  }[]
}) {
  return (
    <ToastStack>
      <Pousseur toasts={toasts} />
    </ToastStack>
  )
}

function Pousseur({
  toasts,
}: {
  readonly toasts: readonly {
    readonly title: string
    readonly description?: string
    readonly severity?: ToastSeverity
    readonly source?: ToastSource
  }[]
}) {
  const pousser = useToast()

  return (
    <Button
      onClick={() => {
        for (const toast of toasts) pousser(toast)
      }}
    >
      Pousser
    </Button>
  )
}

async function pousser(
  toasts: readonly {
    readonly title: string
    readonly description?: string
    readonly severity?: ToastSeverity
    readonly source?: ToastSource
  }[],
) {
  render(<Ecran toasts={toasts} />)
  await userEvent.click(screen.getByRole('button', { name: 'Pousser' }))
}

describe('ToastStack', () => {
  it('annonce la région en français, poliment', async () => {
    // Base UI pose « Notifications » — de la copie produit, donc en français. Et `polite` parce
    // qu'un toast ne doit pas couper la phrase que le lecteur d'écran est en train de lire.
    await pousser([{ title: 'Route « MTN CI direct » enregistrée', severity: 'success' }])

    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('rend le titre et le corps du toast', async () => {
    await pousser([
      {
        description: 'Évalué par Alertmanager, indépendamment du tableau de bord.',
        severity: 'critical',
        title: 'mtn-ci : taux d’erreur au-dessus de 5 %',
      },
    ])

    expect(screen.getByText('mtn-ci : taux d’erreur au-dessus de 5 %')).toBeInTheDocument()
    expect(
      screen.getByText('Évalué par Alertmanager, indépendamment du tableau de bord.'),
    ).toBeInTheDocument()
  })

  it('donne à chaque sévérité sa classe, et à `info` celle du défaut', async () => {
    await pousser([
      { severity: 'critical', title: 'Critique' },
      { severity: 'warning', title: 'Avertissement' },
      { title: 'Information' },
    ])

    expect(screen.getByText('Critique').closest('.ui-toast--critical')).not.toBeNull()
    expect(screen.getByText('Avertissement').closest('.ui-toast--warning')).not.toBeNull()
    expect(screen.getByText('Information').closest('.ui-toast--info')).not.toBeNull()
  })

  /**
   * **La source, et pourquoi elle porte une couleur.**
   *
   * « The UI states which one detected — blue for `alertmanager`, violet for `bff`. » Les deux
   * classes sont distinctes parce que les deux couleurs le sont ; les confondre reviendrait à dire
   * que les deux étages se réparent pareil.
   */
  it('distingue les deux étages qui détectent', async () => {
    await pousser([
      { severity: 'critical', source: 'alertmanager', title: 'Lien orange-sn-1 en panne' },
      { severity: 'warning', source: 'bff', title: 'Solde bas sur bulk-sms-ci' },
    ])

    const infra = screen.getByText('Lien orange-sn-1 en panne').closest('.ui-toast')
    const metier = screen.getByText('Solde bas sur bulk-sms-ci').closest('.ui-toast')

    expect(infra?.querySelector('.ui-toast__source--alertmanager')).toHaveTextContent(
      'source · alertmanager',
    )
    expect(metier?.querySelector('.ui-toast__source--bff')).toHaveTextContent('source · bff')
    expect(infra?.querySelector('.ui-toast__source--bff')).toBeNull()
  })

  it('n’affiche aucune source quand personne ne l’a nommée', async () => {
    // Une confirmation d'action n'a pas d'étage de détection. Inventer une source par défaut ferait
    // dire au toast quelque chose que personne n'a mesuré.
    await pousser([{ severity: 'success', title: 'Route enregistrée' }])

    expect(
      screen
        .getByText('Route enregistrée')
        .closest('.ui-toast')
        ?.querySelector('[class*="ui-toast__source"]'),
    ).toBeNull()
  })

  /**
   * **Ce que ce test prouve, et ce qu'il ne prouve pas.**
   *
   * Il prouve que le quatrième toast est *marqué* : Base UI le rend avec `data-limited` plutôt que
   * de le retirer. Il ne prouve **pas** qu'il disparaît de l'écran — c'est la règle `display: none`
   * de la feuille qui le fait, et jsdom n'applique aucun CSS. Mesuré en remplaçant cette règle par
   * une opacité : les 254 tests restaient verts.
   *
   * La preuve manquante est donc dans le parcours Playwright, seul endroit où l'on lit ce qui est
   * peint. Les deux ensemble tiennent le plafond ; ni l'une ni l'autre ne suffit.
   */
  it('marque comme excédentaire tout toast au-delà du troisième', async () => {
    await pousser([{ title: 'Un' }, { title: 'Deux' }, { title: 'Trois' }, { title: 'Quatre' }])

    const tous = screen.getAllByRole('dialog')
    const marques = tous.filter((toast) => toast.hasAttribute('data-limited'))

    expect(tous).toHaveLength(4)
    expect(marques).toHaveLength(1)
    expect(marques[0]).toHaveTextContent('Un')
  })

  /**
   * **« Toujours fermable », et par où.**
   *
   * Base UI masque le bouton Fermer à l'arbre d'accessibilité tant que la pile n'est ni développée
   * ni focalisée — `'aria-hidden': !expanded && !hasFocus`, mesuré dans `ToastClose.mjs`. Ce n'est
   * pas un oubli : la région live annonce déjà le toast, et un bouton annoncé en plus à chaque
   * notification couperait la lecture pour rien. Il s'expose dès que le focus entre.
   *
   * C'est ce chemin-là qu'il faut tenir, et non la simple présence du bouton : un `Fermer` qu'on
   * n'atteint qu'à la souris ne rend pas un toast fermable pour tout le monde.
   */
  it('expose son bouton Fermer dès que le focus entre, et se ferme par lui', async () => {
    await pousser([{ title: 'Route enregistrée', severity: 'success' }])

    const toast = screen.getByRole('dialog')
    expect(toast.querySelector('.ui-toast__close')).toHaveAttribute('aria-hidden', 'true')

    toast.focus()

    const fermer = await screen.findByRole('button', { name: 'Fermer' })
    await userEvent.click(fermer)

    await waitFor(() => {
      expect(screen.queryByText('Route enregistrée')).toBeNull()
    })
  })

  it('laisse une alerte critique trois secondes de plus que les autres', () => {
    // Pas un test de rendu : une affirmation sur la valeur que la charte fixe — « éphémères,
    // auto-disparition ». Les deux durées sont lues ici pour qu'un changement se voie.
    expect(TOAST_TIMEOUT.critical).toBe(9000)
    expect(TOAST_TIMEOUT.default).toBe(6000)
    expect(TOAST_TIMEOUT.critical - TOAST_TIMEOUT.default).toBe(3000)
  })
})
