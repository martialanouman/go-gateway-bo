/**
 * Le champ de saisie, et la seule chose qui compte vraiment : **un champ invalide s'annonce**.
 *
 * Une bordure rouge n'existe pas pour qui n'a pas l'écran. La charte et la WCAG 2.1 AA demandent
 * la même chose — le message doit être **lié au contrôle**, pour qu'un lecteur d'écran le lise au
 * moment où le focus arrive, pas trois éléments plus loin.
 *
 * C'est aussi la raison de s'appuyer sur `Field` de Base UI plutôt que de câbler `aria-describedby`
 * à la main : l'identifiant est généré et relié par la bibliothèque, donc il ne peut pas se
 * désynchroniser au premier renommage.
 */

import { describe, expect, it } from 'vitest'
import { renderComponent } from '~/test/render'
import { TextField } from './text-field'

describe('TextField', () => {
  it('relie son libellé au contrôle', async () => {
    const { getByLabelText, user } = renderComponent(<TextField label="Adresse e-mail" />)

    const input = getByLabelText('Adresse e-mail')
    await user.type(input, 'operatrice@example.test')

    expect(input).toHaveValue('operatrice@example.test')
  })

  it('lie le message d’erreur au contrôle, et pas seulement une bordure rouge', () => {
    const { getByLabelText, getByText } = renderComponent(
      <TextField label="Adresse e-mail" error="Cette adresse n’est pas reconnue." />,
    )

    const input = getByLabelText('Adresse e-mail')
    const message = getByText('Cette adresse n’est pas reconnue.')

    expect(input).toHaveAttribute('aria-invalid', 'true')
    // Le lien, et pas seulement la présence : c'est lui que la technologie d'assistance suit.
    expect(input.getAttribute('aria-describedby') ?? '').toContain(message.id)
  })

  it('lie aussi l’aide quand il n’y a pas d’erreur', () => {
    const { getByLabelText, getByText } = renderComponent(
      <TextField label="max_sessions" hint="Baisser ce quota ne coupe pas les binds vivants." />,
    )

    const input = getByLabelText('max_sessions')
    const hint = getByText('Baisser ce quota ne coupe pas les binds vivants.')

    expect(input.getAttribute('aria-describedby') ?? '').toContain(hint.id)
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('montre l’erreur plutôt que l’aide quand les deux sont fournies', () => {
    // Empiler les deux noierait la conséquence sous le mode d'emploi, au moment où elle compte.
    const { queryByText } = renderComponent(
      <TextField
        label="Sender ID"
        hint="Onze caractères au plus."
        error="Ce sender ID est déjà pris."
      />,
    )

    expect(queryByText('Ce sender ID est déjà pris.')).toBeInTheDocument()
    expect(queryByText('Onze caractères au plus.')).not.toBeInTheDocument()
  })

  it('rend les valeurs machine en mono, jamais le texte narratif', () => {
    // « Le mono est réservé aux valeurs machine » — un MSISDN, un identifiant, un compteur.
    const { getByLabelText } = renderComponent(<TextField label="MSISDN" mono />)

    expect(getByLabelText('MSISDN')).toHaveClass('ui-input--mono')
  })

  it('marque le champ requis sans compter sur l’astérisque seul', () => {
    const { getByLabelText } = renderComponent(<TextField label="Nom du client" required />)

    expect(getByLabelText(/Nom du client/)).toBeRequired()
  })
})
