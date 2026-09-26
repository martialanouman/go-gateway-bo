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
describe('composed Field and Input', () => {
  it('links the label to the control', async () => {
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

  it('links the refusal message to the control, not just a red border', () => {
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

  it('also links the help when there is no refusal', () => {
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

  it('shows the refusal rather than the help when both are provided', () => {
    // Empiler le mode d'emploi sous la conséquence noierait la seconde au moment où elle compte.
    render(
      <Field label="Sender ID" hint="Onze caractères au plus." error="Ce sender ID est déjà pris.">
        <Input />
      </Field>,
    )

    expect(screen.getByText('Ce sender ID est déjà pris.')).toBeInTheDocument()
    expect(screen.queryByText('Onze caractères au plus.')).toBeNull()
  })

  it('does not treat an empty string as a refusal', () => {
    // **Le geste le plus naturel du monde** : `error={apiError ?? ''}`, ou un champ d'erreur que le
    // serveur rend vide. Une comparaison à `undefined`/`null`/`false` laissait passer `''`, et
    // fabriquait un champ **invalide muet** — bordure rouge, `aria-invalid`, message vide relié, et
    // l'aide effacée au passage. L'opérateur voit un refus sans motif.
    render(
      <Field label="Adresse e-mail" hint="Celle du compte opérateur." error="">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Adresse e-mail')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    // Et l'aide n'a pas été effacée par un refus qui n'existe pas.
    expect(screen.getByText('Celle du compte opérateur.')).toBeInTheDocument()
  })

  it('announces a refusal that arrives afterwards, without the focus having moved', () => {
    // Un refus vient du serveur : il apparaît **après** la soumission, alors que le focus n'a pas
    // bougé. Base UI ne pose ni rôle ni région live sur `Field.Error` — le message atterrit dans un
    // élément inerte que les lecteurs d'écran ne relisent pas. WCAG 2.1 AA, 4.1.3.
    render(
      <Field label="Sender ID" error="Ce sender ID est déjà pris.">
        <Input />
      </Field>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Ce sender ID est déjà pris.')
  })

  it('carries the required flag on the control, where it is announced', () => {
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

describe('standalone Input', () => {
  it('accepts input outside a Field — the filter bar case', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Rechercher" icon="search" placeholder="Rechercher un MSISDN…" />)

    const input = screen.getByRole('textbox', { name: 'Rechercher' })
    await user.type(input, '+225')

    expect(input).toHaveValue('+225')
  })

  it('switches to mono on request — the design charter reserves it for machine values', () => {
    // « Jamais pour du texte narratif » : identifiant, compteur, MSISDN, sender ID.
    render(<Input aria-label="MSISDN" mono />)

    expect(screen.getByRole('textbox')).toHaveClass('ui-input--mono')
  })
})
