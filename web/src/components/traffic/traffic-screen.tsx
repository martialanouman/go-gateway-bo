import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '~/components/page-header'
import { Banner, Card, EmptyState, ErrorState, LoadingState, Skeleton } from '~/components/ui'
import { orRefusal } from '~/lib/administration'
import { api } from '~/lib/api'
import { failureRatios, latency, perSecond, successRate, totals } from '~/lib/traffic'
import { Chart } from './chart'
import { MetricTile } from './metric-tile'

const REFRESH_MS = 10_000
const SUBTITLE = '5 dernières minutes · tranches de 10 s'

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
  const points = traffic.data === undefined ? [] : totals(traffic.data)
  const ratios = failureRatios(points)
  const worst = Math.round(Math.max(0, ...ratios) * 1000) / 10

  return (
    <div className="page">
      <PageHeader title="Trafic" />
      {summary.data === undefined || traffic.data === undefined ? (
        failed === null ? (
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
            description={failed.error?.message}
            onRetry={retry}
            title="Le trafic n’a pas pu être chargé"
            titleAs="h2"
          />
        )
      ) : (
        <>
          {failed === null ? null : (
            <Banner title="Le trafic n’a pas pu être actualisé">
              Les dernières valeurs restent affichées. {failed.error?.message}
            </Banner>
          )}
          {summary.data.submitted === 0 ? (
            <EmptyState
              description="Les compteurs reprennent dès le prochain message."
              title="Aucun message soumis sur les cinq dernières minutes"
              titleAs="h2"
            />
          ) : (
            <>
              <div className="traffic-tiles">
                <MetricTile label="MT / s" tone="mt" value={perSecond(summary.data.submitted)} />
                <MetricTile label="MO / s" tone="mo" value={perSecond(summary.data.moReceived)} />
                <MetricTile label="Taux de succès" unit="%" value={successRate(summary.data)} />
                <MetricTile label="Latence p50" value={latency(summary.data.e2eLatencyMsP50)} />
                <MetricTile label="Latence p99" value={latency(summary.data.e2eLatencyMsP99)} />
                <MetricTile
                  label="Sessions actives"
                  value={summary.data.activeSessions?.toString() ?? null}
                />
              </div>
              <div className="traffic-charts">
                <Card subtitle={SUBTITLE} title="Débit MT">
                  <Chart
                    label={`Débit MT, soumis et remis, ${points.length} tranches`}
                    primary={points.map((point) => point.submitted)}
                    secondary={points.map((point) => point.delivered)}
                  />
                </Card>
                <Card subtitle={SUBTITLE} title="Taux d’échec">
                  <Chart
                    label={`Taux d’échec par tranche, maximum ${worst.toLocaleString('fr-FR')} %`}
                    primary={ratios}
                  />
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
