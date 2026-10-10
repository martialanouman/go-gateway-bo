import type { components } from '~/lib/api.gen'

type Summary = components['schemas']['MetricsSummary']
type Metrics = components['schemas']['TrafficMetrics']
export type TrafficPoint = components['schemas']['TrafficPoint']

export const WINDOW_SECONDS = 300

const oneDecimal = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const twoDecimals = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function perSecond(count: number) {
  return oneDecimal.format(count / WINDOW_SECONDS)
}

export function successRate({ delivered, failed, rejected }: Summary) {
  const known = delivered + failed + rejected
  return known === 0 ? null : oneDecimal.format((delivered / known) * 100)
}

export function latency(ms: number | null) {
  if (ms === null) return null
  return ms < 1000 ? `${Math.round(ms)} ms` : `${twoDecimals.format(ms / 1000)} s`
}

export function totals(metrics: Metrics): TrafficPoint[] {
  const byTime = new Map<string, TrafficPoint>()
  for (const series of metrics.series) {
    for (const point of series.points) {
      const sum = byTime.get(point.t) ?? { t: point.t, submitted: 0, delivered: 0, failed: 0 }
      byTime.set(point.t, {
        t: point.t,
        submitted: sum.submitted + point.submitted,
        delivered: sum.delivered + point.delivered,
        failed: sum.failed + point.failed,
      })
    }
  }
  return [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t))
}

export function failureRatios(points: readonly TrafficPoint[]) {
  return points.map(({ submitted, failed }) => (submitted === 0 ? 0 : failed / submitted))
}
