import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function seriesOf(counts: { submitted: number; moReceived: number }) {
  return {
    groupBy: 'customer',
    window: '5m',
    series: [
      {
        key: 'acme',
        points: [0, 10].map((second) => ({
          t: `2026-10-10T12:00:${String(second).padStart(2, '0')}Z`,
          submitted: counts.submitted,
          delivered: counts.submitted,
          failed: 0,
          moReceived: counts.moReceived,
        })),
      },
    ],
  }
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
    expect(
      await screen.findByRole('img', {
        name: 'Débit MT, soumis et remis, pic de 600 par tranche, dernière tranche 600',
      }),
    ).toBeVisible()
    expect(screen.getByText('Soumis')).toBeVisible()
    expect(screen.getByText('Remis')).toBeVisible()
    expect(screen.getByRole('img', { name: /Taux d’échec/ })).toBeVisible()
    expect(
      screen.getByRole('img', { name: 'Débit MO, pic de 120 par tranche, dernière tranche 120' }),
    ).toBeVisible()
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

  it('says each chart is empty rather than drawing zeros, and keeps the MO flowing without MT', async () => {
    await visitTraffic({
      metricsSummary: { status: 200, body: { ...EMPTY_SUMMARY, moReceived: 6000 } },
      trafficMetrics: { status: 200, body: seriesOf({ submitted: 0, moReceived: 200 }) },
    })
    const mt = await screen.findByRole('region', { name: 'Débit MT' })
    expect(within(mt).getByText('Aucun MT soumis sur les cinq dernières minutes')).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'Taux d’échec' })).getByText(
        'Aucun MT soumis sur les cinq dernières minutes',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('img', { name: /Débit MT/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Taux d’échec/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Débit MO, pic de 200/ })).toBeVisible()
    expect(screen.getByText('20,0')).toBeVisible()
  })

  it('says the MO chart is empty when no MO was received', async () => {
    await visitTraffic({
      trafficMetrics: { status: 200, body: seriesOf({ submitted: 300, moReceived: 0 }) },
    })
    const mo = await screen.findByRole('region', { name: 'Débit MO' })
    expect(within(mo).getByText('Aucun MO reçu sur les cinq dernières minutes')).toBeVisible()
    expect(screen.queryByRole('img', { name: /Débit MO/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Débit MT/ })).toBeVisible()
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

  it('keeps the tiles when only the series fail, and retries the charts alone', async () => {
    let seriesDown = true
    const { fetch } = await visitTraffic({
      get trafficMetrics() {
        return seriesDown
          ? {
              status: 503,
              body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' },
            }
          : undefined
      },
    })
    expect(
      await screen.findByText('Les graphiques du trafic n’ont pas pu être chargés'),
    ).toBeVisible()
    expect(screen.getByText('30,0')).toBeVisible()
    const summaryCalls = () =>
      fetch.mock.calls.filter(([request]) => request.url.includes('/api/metrics/summary')).length
    const summaryCallsBeforeRetry = summaryCalls()

    seriesDown = false
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))

    expect(await screen.findByRole('img', { name: /Débit MT/ })).toBeVisible()
    expect(summaryCalls()).toBe(summaryCallsBeforeRetry)
  })

  it('reads the figures again when the retry is used', async () => {
    let gatewayDown = true
    await visitTraffic({
      get metricsSummary() {
        return gatewayDown
          ? {
              status: 503,
              body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' },
            }
          : undefined
      },
    })
    const retry = await screen.findByRole('button', { name: 'Réessayer' })

    gatewayDown = false
    await userEvent.click(retry)

    expect(await screen.findByText('30,0')).toBeVisible()
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

  it('polls both endpoints every ten seconds and recovers after a failed poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let gatewayDown = false
      const { fetch } = await visitTraffic({
        get metricsSummary() {
          return gatewayDown
            ? {
                status: 503,
                body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' },
              }
            : undefined
        },
      })
      const count = (path: string) =>
        fetch.mock.calls.filter(([request]) => request.url.includes(path)).length
      expect(await screen.findByText('30,0')).toBeVisible()
      expect(count('/api/metrics/summary')).toBe(1)
      expect(count('/api/metrics/traffic')).toBe(1)

      gatewayDown = true
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await screen.findByText(/Les dernières valeurs restent affichées/)).toBeVisible()
      expect(count('/api/metrics/summary')).toBe(2)
      expect(count('/api/metrics/traffic')).toBe(2)

      gatewayDown = false
      await vi.advanceTimersByTimeAsync(10_000)
      await waitFor(() =>
        expect(
          screen.queryByText(/Les dernières valeurs restent affichées/),
        ).not.toBeInTheDocument(),
      )
      expect(screen.getByText('30,0')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })
})
