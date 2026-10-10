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
  })

  it('sums every series, other included, per bucket', () => {
    const points = totals({
      groupBy: 'customer',
      window: '5m',
      series: [
        {
          key: 'a',
          points: [
            { t: '2026-10-10T10:00:10Z', submitted: 3, delivered: 2, failed: 1 },
            { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0 },
          ],
        },
        {
          key: 'other',
          points: [{ t: '2026-10-10T10:00:10Z', submitted: 5, delivered: 4, failed: 0 }],
        },
      ],
    })
    expect(points).toEqual([
      { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0 },
      { t: '2026-10-10T10:00:10Z', submitted: 8, delivered: 6, failed: 1 },
    ])
    expect(failureRatios(points)).toEqual([0, 0.125])
  })
})
