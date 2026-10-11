import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '~/components/page-header'
import { Banner, Card, EmptyState, ErrorState, LoadingState, Skeleton } from '~/components/ui'
import { orRefusal } from '~/lib/administration'
import { api } from '~/lib/api'
import {
  bucketRate,
  failureRatios,
  latency,
  percent,
  perSecond,
  successRate,
  totals,
} from '~/lib/traffic'
import { Chart } from './chart'
import { MetricTile } from './metric-tile'

const REFRESH_MS = 10_000
const integer = new Intl.NumberFormat('fr-FR')
const clock = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' })
const SUBTITLE = '5 dernières minutes · tranches de 10 s'
const NO_MT = 'Aucun MT soumis sur les cinq dernières minutes'

function readout(series: readonly number[], format: (value: number) => string) {
  return { last: format(series.at(-1) ?? 0), peak: format(Math.max(0, ...series)) }
}

export function TrafficScreen() {
  const summary = useQuery({
    queryKey: ['metrics', 'summary', '5m'],
    queryFn: () =>
      orRefusal(
        api.GET('/metrics/summary', { params: { query: { window: '5m' } } }),
        'Le trafic n’a pas pu être lu',
      ),
    refetchInterval: REFRESH_MS,
    retry: false,
  })
  const traffic = useQuery({
    queryKey: ['metrics', 'traffic', '5m', 'customer'],
    queryFn: () =>
      orRefusal(
        api.GET('/metrics/traffic', { params: { query: { window: '5m', groupBy: 'customer' } } }),
        'Le trafic n’a pas pu être lu',
      ),
    refetchInterval: REFRESH_MS,
    retry: false,
  })
  const retry = () => {
    void summary.refetch()
    void traffic.refetch()
  }
  const failed = summary.isError ? summary : traffic.isError ? traffic : null
  const chartsFailed = traffic.isError && traffic.data === undefined
  const stale = summary.isError || (traffic.isError && !chartsFailed)
  const points = traffic.data === undefined ? [] : totals(traffic.data)
  const window = traffic.data?.window ?? '5m'
  const rate = (count: number) => bucketRate(count, window)
  const mtSeries = points.map((point) => point.submitted)
  const moSeries = points.map((point) => point.moReceived)
  const ratios = failureRatios(points)
  const mt = readout(mtSeries, rate)
  const mo = readout(moSeries, rate)
  const failure = readout(ratios, percent)
  const timeAt = (index: number) => {
    const t = points[index]?.t
    return t === undefined ? '' : clock.format(new Date(t))
  }
  const noMt = mtSeries.every((count) => count === 0)
  const noMo = moSeries.every((count) => count === 0)

  return (
    <div className="page">
      <PageHeader title="Trafic" />
      {summary.data === undefined ? (
        !summary.isError ? (
          <LoadingState label="Chargement du trafic…">
            <div className="traffic-tiles">
              {Array.from({ length: 6 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: silhouette fixe.
                <Skeleton height={72} key={index} />
              ))}
            </div>
            <Skeleton height={140} />
          </LoadingState>
        ) : (
          <ErrorState
            description={summary.error?.message}
            onRetry={retry}
            title="Le trafic n’a pas pu être chargé"
            titleAs="h2"
          />
        )
      ) : (
        <>
          {stale ? (
            <Banner title="Le trafic n’a pas pu être actualisé">
              Les dernières valeurs restent affichées. {failed?.error?.message}
            </Banner>
          ) : null}
          <div className="traffic-tiles">
            <MetricTile label="MT / s" tone="mt" value={perSecond(summary.data.submitted)} />
            <MetricTile label="MO / s" tone="mo" value={perSecond(summary.data.moReceived)} />
            <MetricTile label="Succès MT" unit="%" value={successRate(summary.data)} />
            <MetricTile label="Latence MT p50" value={latency(summary.data.e2eLatencyMsP50)} />
            <MetricTile label="Latence MT p99" value={latency(summary.data.e2eLatencyMsP99)} />
            <MetricTile
              label="Sessions SMPP"
              value={
                summary.data.activeSessions === null || summary.data.activeSessions === undefined
                  ? null
                  : integer.format(summary.data.activeSessions)
              }
            />
          </div>
          {chartsFailed ? (
            <ErrorState
              description={traffic.error?.message}
              onRetry={() => void traffic.refetch()}
              title="Les graphiques du trafic n’ont pas pu être chargés"
              titleAs="h2"
            />
          ) : traffic.data === undefined ? (
            <LoadingState label="Chargement des graphiques…">
              <Skeleton height={140} />
            </LoadingState>
          ) : (
            <div className="traffic-charts">
              <Card subtitle={SUBTITLE} title="Débit MT">
                {noMt ? (
                  <EmptyState inline title={NO_MT} />
                ) : (
                  <>
                    <Chart
                      label={`Débit MT, soumis et remis : ${mt.last} par seconde à la dernière tranche, pic ${mt.peak}`}
                      describe={(index) => [
                        timeAt(index),
                        `Soumis ${rate(mtSeries[index] ?? 0)} /s`,
                        `Remis ${rate(points[index]?.delivered ?? 0)} /s`,
                      ]}
                      primary={mtSeries}
                      secondary={points.map((point) => point.delivered)}
                    />
                    <ul className="traffic-legend">
                      <li className="traffic-legend__item traffic-legend__item--primary">Soumis</li>
                      <li className="traffic-legend__item traffic-legend__item--secondary">
                        Remis
                      </li>
                    </ul>
                  </>
                )}
              </Card>
              <Card subtitle={SUBTITLE} title="Débit MO">
                {noMo ? (
                  <EmptyState inline title="Aucun MO reçu sur les cinq dernières minutes" />
                ) : (
                  <Chart
                    label={`Débit MO : ${mo.last} par seconde à la dernière tranche, pic ${mo.peak}`}
                    describe={(index) => [timeAt(index), `Reçus ${rate(moSeries[index] ?? 0)} /s`]}
                    primary={moSeries}
                  />
                )}
              </Card>
              <Card subtitle={`${SUBTITLE} · hors rejets`} title="Taux d’échec MT">
                {noMt ? (
                  <EmptyState inline title={NO_MT} />
                ) : (
                  <Chart
                    label={`Taux d’échec MT : ${failure.last} % à la dernière tranche, pic ${failure.peak} %`}
                    describe={(index) => [timeAt(index), `Échec ${percent(ratios[index] ?? 0)} %`]}
                    primary={ratios}
                    tone="warning"
                  />
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
