import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '~/router'
import { type AuthReplies, stubSession } from '../../test/session'

afterEach(() => vi.restoreAllMocks())

const EMPTY_SUMMARY = {
  window: '5m',
  submitted: 0,
  delivered: 0,
  failed: 0,
  rejected: 0,
  moReceived: 0,
  e2eLatencyMsP50: null,
  e2eLatencyMsP99: null,
  activeSessions: null,
}

async function visitTraffic(replies: AuthReplies = {}) {
  const fetch = stubSession({ permissions: ['traffic:read'] }, replies)
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/traffic'] }))
  render(<RouterProvider router={router} />)

  return { fetch, queryClient: router.options.context.queryClient }
}

describe('the traffic screen', () => {
  it('shows the figures of the last five minutes', async () => {
    await visitTraffic()
    expect(await screen.findByText('30,0')).toBeVisible()
    expect(screen.getByText('2,0')).toBeVisible()
    expect(screen.getByText('97,6')).toBeVisible()
    expect(screen.getByText('180 ms')).toBeVisible()
    expect(screen.getByText('1,24 s')).toBeVisible()
    expect(screen.getByText('non mesurée')).toBeVisible()
    expect(await screen.findByRole('img', { name: /Débit MT/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /Taux d’échec/ })).toBeVisible()
  })

  it('asks the gateway for the five-minute window, per customer', async () => {
    const { fetch } = await visitTraffic()
    await screen.findByText('30,0')
    const urls = fetch.mock.calls.map(([request]) => request.url)
    expect(urls.some((url) => url.endsWith('/api/metrics/summary?window=5m'))).toBe(true)
    expect(
      urls.some(
        (url) =>
          url.includes('/api/metrics/traffic?') &&
          url.includes('groupBy=customer') &&
          url.includes('window=5m'),
      ),
    ).toBe(true)
  })

  it('says the window is empty rather than drawing zeros', async () => {
    await visitTraffic({ metricsSummary: { status: 200, body: EMPTY_SUMMARY } })
    expect(
      await screen.findByText('Aucun message soumis sur les cinq dernières minutes'),
    ).toBeVisible()
  })

  it('names the failure and offers a retry when the gateway is unavailable', async () => {
    await visitTraffic({
      metricsSummary: {
        status: 503,
        body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' },
      },
    })
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeVisible()
  })

  it('keeps the last values on screen and says so when a later poll fails', async () => {
    let gatewayDown = false
    const { queryClient } = await visitTraffic({
      get metricsSummary() {
        return gatewayDown
          ? {
              status: 503,
              body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' },
            }
          : undefined
      },
    })
    expect(await screen.findByText('30,0')).toBeVisible()

    gatewayDown = true
    await queryClient.refetchQueries({ queryKey: ['metrics', 'summary'] })

    expect(await screen.findByText(/Les dernières valeurs restent affichées/)).toBeVisible()
    expect(screen.getByText('30,0')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument()
  })
})
