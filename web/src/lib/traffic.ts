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
  const rounded = Math.round(ms)
  return rounded < 1000 ? `${rounded} ms` : `${twoDecimals.format(ms / 1000)} s`
}

const STEP_SECONDS: Record<string, number> = { '5m': 10, '15m': 30, '30m': 60, '1h': 60 }

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
  const sorted = [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t))
  const stepMs = (STEP_SECONDS[metrics.window] ?? 0) * 1000
  if (stepMs === 0) return sorted
  return sorted.flatMap((point, index) => {
    const gap: TrafficPoint[] = []
    if (index > 0) {
      const previous = Date.parse(sorted[index - 1]?.t ?? point.t)
      for (let ms = previous + stepMs; ms < Date.parse(point.t); ms += stepMs) {
        gap.push({
          t: new Date(ms).toISOString().replace('.000Z', 'Z'),
          submitted: 0,
          delivered: 0,
          failed: 0,
        })
      }
    }
    return [...gap, point]
  })
}

export function failureRatios(points: readonly TrafficPoint[]) {
  return points.map(({ submitted, failed }) => (submitted === 0 ? 0 : failed / submitted))
}
