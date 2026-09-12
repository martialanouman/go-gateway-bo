import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Field, Input } from './field'

/**
 * Le champ, et la seule chose qui compte vraiment : **un champ invalide s'annonce**.
 *
 * Une bordure rouge n'existe pas pour qui n'a pas l'écran. La WCAG 2.1 AA demande que le message
 * soit **lié au contrôle**, pour qu'il soit lu quand le focus arrive, pas trois éléments plus loin.
 *
 * C'est ce que ce découpage protège. `Field` et `Input` sont deux composants — la charte les nomme
 * ainsi, et une barre de filtre veut un `Input` sans libellé au-dessus. Séparés, un écran pourrait
 * écrire une bordure rouge sans message lié ; c'est pourquoi le lien n'est pas à sa charge :
 * `Field.Root` et `Field.Control` de Base UI engendrent les identifiants et les relient dès que
 * l'un est dans l'autre. L'appelant n'écrit aucun `id`, donc il ne peut pas les désynchroniser.
 *
 * Ces tests-là vérifient le lien **à travers la composition**, pas la présence des deux morceaux.
 */
describe('Field et Input composés', () => {
  it('relie le libellé au contrôle', async () => {
    const user = userEvent.setup()
    render(
      <Field label="Adresse e-mail">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Adresse e-mail')
    await user.type(input, 'operatrice@example.test')

    expect(input).toHaveValue('operatrice@example.test')
  })

  it('lie le message de refus au contrôle, et pas seulement une bordure rouge', () => {
    render(
      <Field label="Adresse e-mail" error="Cette adresse n’est pas reconnue.">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Adresse e-mail')
    const message = screen.getByText('Cette adresse n’est pas reconnue.')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    // Le lien, et pas seulement la présence : c'est lui que la technologie d'assistance suit.
    expect(input.getAttribute('aria-describedby') ?? '').toContain(message.id)
  })

  it('lie aussi l’aide quand il n’y a pas de refus', () => {
    render(
      <Field label="max_sessions" hint="Baisser ce quota ne coupe pas les binds vivants.">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('max_sessions')
    const hint = screen.getByText('Baisser ce quota ne coupe pas les binds vivants.')

    expect(input.getAttribute('aria-describedby') ?? '').toContain(hint.id)
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('montre le refus plutôt que l’aide quand les deux sont fournis', () => {
    // Empiler le mode d'emploi sous la conséquence noierait la seconde au moment où elle compte.
    render(
      <Field label="Sender ID" hint="Onze caractères au plus." error="Ce sender ID est déjà pris.">
        <Input />
      </Field>,
    )

    expect(screen.getByText('Ce sender ID est déjà pris.')).toBeInTheDocument()
    expect(screen.queryByText('Onze caractères au plus.')).toBeNull()
  })

  it('porte le caractère obligatoire sur le contrôle, où il est annoncé', () => {
    // L'astérisque du libellé n'est pas une prop du `Field` : il découle de cet état-ci, par
    // `:has()` dans la feuille. Le déclarer deux fois laisserait la marque visuelle affirmer le
    // contraire de la sémantique. La marque elle-même n'est pas observable ici — jsdom n'applique
    // pas le CSS —, elle l'est sur le parcours de bout en bout.
    render(
      <Field label="Nom du client">
        <Input required />
      </Field>,
    )

    expect(screen.getByRole('textbox', { name: 'Nom du client' })).toBeRequired()
  })
})

describe('Input seul', () => {
  it('se saisit hors d’un Field — le cas de la barre de filtre', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Rechercher" icon="search" placeholder="Rechercher un MSISDN…" />)

    const input = screen.getByRole('textbox', { name: 'Rechercher' })
    await user.type(input, '+225')

    expect(input).toHaveValue('+225')
  })

  it('passe en mono sur demande — la charte le réserve aux valeurs machine', () => {
    // « Jamais pour du texte narratif » : identifiant, compteur, MSISDN, sender ID.
    render(<Input aria-label="MSISDN" mono />)

    expect(screen.getByRole('textbox')).toHaveClass('ui-input--mono')
  })
})
