import './traffic.css'

export function MetricTile({
  label,
  value,
  unit,
  tone,
}: {
  readonly label: string
  readonly value: string | null
  readonly unit?: string
  readonly tone?: 'mt' | 'mo'
}) {
  return (
    <div className={tone ? `metric-tile metric-tile--${tone}` : 'metric-tile'}>
      <div className="metric-tile__label">{label}</div>
      {value === null ? (
        <div className="metric-tile__unmeasured">non mesurée</div>
      ) : (
        <div className="metric-tile__value">
          {value}
          {unit ? <span className="metric-tile__unit">{unit}</span> : null}
        </div>
      )}
    </div>
  )
}
