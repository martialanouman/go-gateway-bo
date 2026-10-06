import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { PermissionKey } from '~/lib/permissions.gen'
import { createAppRouter } from '~/router'
import { ACME, sender, stubAdministration } from '../../test/administration'

const WRITER: PermissionKey[] = ['customers:read', 'customers:write']
const READER: PermissionKey[] = ['customers:read']
const SENDER = `/api/customers/${ACME.id}/sender-ids/sender-1`

function open(permissions: PermissionKey[], senders: ReturnType<typeof sender>[]) {
  const fetch = stubAdministration({ permissions }, { senders })
  render(
    <RouterProvider
      router={createAppRouter(createMemoryHistory({ initialEntries: [`/customers/${ACME.id}`] }))}
    />,
  )
  return fetch
}

function sent(fetch: ReturnType<typeof stubAdministration>, route: string) {
  return fetch.mock.calls.filter(([request]) => {
    const { method, url } = request as Request
    return `${method} ${new URL(url).pathname}` === route
  })
}

async function rowOf(address: string) {
  return (await screen.findByRole('cell', { name: address })).closest('tr') as HTMLElement
}

describe('the sender IDs of a customer', () => {
  it('shows each name with its category, its own limit and its recent mismatches', async () => {
    open(READER, [
      sender({
        trafficCategory: 'otp',
        rateLimit: { maxPerSec: 50, burstCapacity: 100 },
        recentCategoryMismatches24h: 3,
      }),
    ])

    const row = await rowOf('ACME')
    expect(row).toHaveTextContent('OTP')
    expect(row).toHaveTextContent('50/s, rafale 100')
    expect(within(row).getByRole('cell', { name: '3' })).toBeInTheDocument()
  })

  it('shows an unreadable mismatch counter as unknown, never as zero', async () => {
    open(READER, [sender({ recentCategoryMismatches24h: null })])

    const row = await rowOf('ACME')
    expect(within(row).queryByRole('cell', { name: '0' })).toBeNull()
    expect(within(row).getByRole('cell', { name: 'Inconnu' })).toBeInTheDocument()
  })

  it('says a name without its own limit has none', async () => {
    open(READER, [sender()])

    expect(await rowOf('ACME')).toHaveTextContent('Aucune limite propre')
  })

  it('reclassifies a name only once the consequence is confirmed', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, [sender()])

    await user.click(within(await rowOf('ACME')).getByRole('button', { name: 'Classer ACME' }))
    const dialog = await screen.findByRole('dialog', { name: 'Classer ACME en OTP ?' })
    expect(dialog).toHaveTextContent('Ce trafic passera devant le marketing')
    expect(sent(fetch, `PATCH ${SENDER}`)).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: 'Classer' }))

    expect(await screen.findByText('ACME est classé en OTP.')).toBeInTheDocument()
    const request = sent(fetch, `PATCH ${SENDER}`)[0]?.[0] as Request
    expect(await request.json()).toEqual({ trafficCategory: 'otp' })
    expect(await rowOf('ACME')).toHaveTextContent('OTP')
  })

  it('says a name moved back to marketing loses its priority', async () => {
    const user = userEvent.setup()
    open(WRITER, [sender({ trafficCategory: 'otp' })])

    await user.click(within(await rowOf('ACME')).getByRole('button', { name: 'Classer ACME' }))
    const dialog = await screen.findByRole('dialog', { name: 'Classer ACME en Transactionnel ?' })
    await user.click(within(dialog).getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Marketing' }))

    expect(
      await screen.findByRole('dialog', { name: 'Classer ACME en Marketing ?' }),
    ).toHaveTextContent('perdra sa priorité')
  })

  it('sets a limit, says a refused message leaves no CDR, then removes it', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, [sender()])

    await user.click(within(await rowOf('ACME')).getByRole('button', { name: 'Limiter ACME' }))
    const dialog = await screen.findByRole('dialog', { name: 'Limiter le débit de ACME ?' })
    expect(dialog).toHaveTextContent('aucun CDR')
    await user.type(within(dialog).getByLabelText('Messages par seconde'), '50')
    await user.click(within(dialog).getByRole('button', { name: 'Limiter' }))

    expect(await screen.findByText('ACME est limité à 50/s, rafale 50.')).toBeInTheDocument()
    expect(await rowOf('ACME')).toHaveTextContent('50/s, rafale 50')
    const request = sent(fetch, `PUT ${SENDER}/rate-limit`)[0]?.[0] as Request
    expect(await request.json()).toEqual({ maxPerSec: 50 })

    await user.click(
      within(await rowOf('ACME')).getByRole('button', { name: 'Retirer la limite de ACME' }),
    )
    const removal = await screen.findByRole('dialog', { name: 'Retirer la limite de ACME ?' })
    expect(removal).toHaveTextContent('ne seront plus refusés à l’admission')
    await user.click(within(removal).getByRole('button', { name: 'Retirer' }))

    expect(await screen.findByText('ACME n’a plus de limite propre.')).toBeInTheDocument()

    expect(await rowOf('ACME')).toHaveTextContent('Aucune limite propre')
    expect(sent(fetch, `DELETE ${SENDER}/rate-limit`)).toHaveLength(1)
  })

  it('holds a limit to at least one message per second before anything leaves', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, [sender()])

    await user.click(within(await rowOf('ACME')).getByRole('button', { name: 'Limiter ACME' }))
    const dialog = await screen.findByRole('dialog', { name: 'Limiter le débit de ACME ?' })
    await user.type(within(dialog).getByLabelText('Messages par seconde'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Limiter' }))

    expect(
      await within(dialog).findByText('Saisissez un nombre au moins égal à 1.'),
    ).toBeInTheDocument()
    expect(sent(fetch, `PUT ${SENDER}/rate-limit`)).toHaveLength(0)
  })

  it('keeps only the names of the chosen category, and says how to widen an empty filter', async () => {
    const user = userEvent.setup()
    open(READER, [sender(), sender({ id: 'sender-2', address: 'BANQUEX', trafficCategory: 'otp' })])

    await rowOf('ACME')
    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'OTP' }))

    expect(await rowOf('BANQUEX')).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'ACME' })).toBeNull()

    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Transactionnel' }))

    expect(
      await screen.findByText('Aucun nom d’expéditeur dans cette catégorie'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Choisissez « Toutes les catégories »/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Réinitialiser' }))
    expect(await rowOf('ACME')).toBeInTheDocument()
    expect(await rowOf('BANQUEX')).toBeInTheDocument()
  })

  it('moves the focus to the page title when a reclassified name leaves the filter', async () => {
    const user = userEvent.setup()
    open(WRITER, [sender()])

    await rowOf('ACME')
    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Marketing' }))
    await user.click(within(await rowOf('ACME')).getByRole('button', { name: 'Classer ACME' }))
    const dialog = await screen.findByRole('dialog', { name: 'Classer ACME en OTP ?' })
    await user.click(within(dialog).getByRole('button', { name: 'Classer' }))

    expect(
      await screen.findByText('Aucun nom d’expéditeur dans cette catégorie'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  })

  it('disables and explains deleting a name that has already sent', async () => {
    const user = userEvent.setup()
    const fetch = open(WRITER, [sender({ firstUsedAt: '2026-10-01T08:00:00Z' })])

    const remove = within(await rowOf('ACME')).getByRole('button', { name: 'Supprimer ACME' })
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(remove).toHaveAccessibleDescription(
      'Ce nom a déjà servi à envoyer : désactivez-le plutôt.',
    )

    await user.click(remove)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sent(fetch, `DELETE ${SENDER}`)).toHaveLength(0)
  })

  it('disables and explains reclassifying and limiting without customers:write', async () => {
    open(READER, [sender()])

    const row = await rowOf('ACME')
    for (const name of ['Classer ACME', 'Limiter ACME']) {
      expect(within(row).getByRole('button', { name })).toHaveAccessibleDescription(
        'Modifier un client demande customers:write.',
      )
    }
  })
})
