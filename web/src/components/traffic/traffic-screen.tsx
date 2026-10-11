import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '~/components/page-header'
import { Banner, Card, EmptyState, ErrorState, LoadingState, Skeleton } from '~/components/ui'
import { orRefusal } from '~/lib/administration'
import { api } from '~/lib/api'
import { failureRatios, latency, perSecond, successRate, totals } from '~/lib/traffic'
import { Chart } from './chart'
import { MetricTile } from './metric-tile'

const REFRESH_MS = 10_000
const integer = new Intl.NumberFormat('fr-FR')
const SUBTITLE = '5 dernières minutes · tranches de 10 s'
const NO_MT = 'Aucun MT soumis sur les cinq dernières minutes'

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
  const ratios = failureRatios(points)
  const peak = Math.max(0, ...points.flatMap((point) => [point.submitted, point.delivered]))
  const last = points.at(-1)?.submitted ?? 0
  const worst = Math.round(Math.max(0, ...ratios) * 1000) / 10
  const moSeries = points.map((point) => point.moReceived)
  const peakMo = Math.max(0, ...moSeries)
  const lastMo = moSeries.at(-1) ?? 0
  const noMt = points.every((point) => point.submitted === 0)
  const noMo = peakMo === 0

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
                      label={`Débit MT, soumis et remis, pic de ${integer.format(peak)} par tranche, dernière tranche ${integer.format(last)}`}
                      primary={points.map((point) => point.submitted)}
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
                    label={`Débit MO, pic de ${integer.format(peakMo)} par tranche, dernière tranche ${integer.format(lastMo)}`}
                    primary={moSeries}
                  />
                )}
              </Card>
              <Card subtitle={`${SUBTITLE} · hors rejets`} title="Taux d’échec MT">
                {noMt ? (
                  <EmptyState inline title={NO_MT} />
                ) : (
                  <Chart
                    label={`Taux d’échec MT par tranche, maximum ${worst.toLocaleString('fr-FR')} %`}
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
