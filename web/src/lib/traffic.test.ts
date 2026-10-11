import { describe, expect, it } from 'vitest'
import { failureRatios, latency, perSecond, successRate, totals } from './traffic'

const summary = {
  window: '5m',
  submitted: 9000,
  delivered: 8000,
  failed: 150,
  rejected: 50,
  moReceived: 600,
  e2eLatencyMsP50: 180,
  e2eLatencyMsP99: 1240,
  activeSessions: null,
} as const

describe('traffic figures', () => {
  it('turns a five-minute count into a per-second rate', () => {
    expect(perSecond(9000)).toBe('30,0')
  })

  it('rates success among the messages whose outcome is known', () => {
    expect(successRate(summary)).toBe('97,6')
  })

  it('has no success rate while no outcome is known', () => {
    expect(successRate({ ...summary, delivered: 0, failed: 0, rejected: 0 })).toBeNull()
  })

  it('keeps an unmeasured latency unmeasured instead of zero', () => {
    expect(latency(null)).toBeNull()
    expect(latency(212)).toBe('212 ms')
    expect(latency(1240)).toBe('1,24 s')
    expect(latency(999.6)).toBe('1,00 s')
  })

  it('sums every series, other included, per bucket', () => {
    const points = totals({
      groupBy: 'customer',
      window: '5m',
      series: [
        {
          key: 'a',
          points: [
            { t: '2026-10-10T10:00:10Z', submitted: 3, delivered: 2, failed: 1, moReceived: 2 },
            { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0, moReceived: 0 },
          ],
        },
        {
          key: 'other',
          points: [
            { t: '2026-10-10T10:00:10Z', submitted: 5, delivered: 4, failed: 0, moReceived: 7 },
          ],
        },
      ],
    })
    expect(points).toEqual([
      { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0, moReceived: 0 },
      { t: '2026-10-10T10:00:10Z', submitted: 8, delivered: 6, failed: 1, moReceived: 9 },
    ])
    expect(failureRatios(points)).toEqual([0, 0.125])
  })

  it('fills the buckets the gateway left out with zeros, at the window step', () => {
    const point = (t: string) => ({ t, submitted: 4, delivered: 3, failed: 1, moReceived: 2 })
    const filled = (window: string, times: string[]) =>
      totals({
        groupBy: 'customer',
        window,
        series: [{ key: 'a', points: times.map(point) }],
      }).map(({ t, submitted, moReceived }) => [t, submitted, moReceived])

    expect(filled('5m', ['2026-10-10T10:00:00Z', '2026-10-10T10:00:30Z'])).toEqual([
      ['2026-10-10T10:00:00Z', 4, 2],
      ['2026-10-10T10:00:10Z', 0, 0],
      ['2026-10-10T10:00:20Z', 0, 0],
      ['2026-10-10T10:00:30Z', 4, 2],
    ])
    expect(filled('15m', ['2026-10-10T10:00:00Z', '2026-10-10T10:01:30Z'])).toHaveLength(4)
    expect(filled('1h', ['2026-10-10T10:00:00Z', '2026-10-10T10:03:00Z'])).toHaveLength(4)
    expect(filled('24h', ['2026-10-10T10:00:00Z', '2026-10-10T10:03:00Z'])).toHaveLength(2)
  })

  it('has no failure ratio for a bucket without messages', () => {
    expect(
      failureRatios([
        { t: '2026-10-10T10:00:00Z', submitted: 0, delivered: 0, failed: 0, moReceived: 0 },
      ]),
    ).toEqual([0])
  })
})
