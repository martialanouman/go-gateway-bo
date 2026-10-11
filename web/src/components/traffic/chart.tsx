import './traffic.css'

function path(values: readonly number[], max: number) {
  return values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(2)},${(100 - (v / max) * 100).toFixed(2)}`,
    )
    .join(' ')
}

export function Chart({
  label,
  primary,
  secondary,
  height = 104,
  tone,
}: {
  readonly label: string
  readonly primary: readonly number[]
  readonly secondary?: readonly number[]
  readonly height?: number
  readonly tone?: 'warning'
}) {
  if (primary.length < 2) return <div aria-label={label} role="img" style={{ height }} />
  const peak = Math.max(...primary, ...(secondary ?? []))
  const max = (peak > 0 ? peak : 1) * 1.14
  const line = path(primary, max)
  return (
    <div aria-label={label} role="img" style={{ height }}>
      <svg
        aria-hidden="true"
        className={tone ? `traffic-chart traffic-chart--${tone}` : 'traffic-chart'}
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <line className="traffic-chart__grid" x1="0" x2="100" y1="33" y2="33" />
        <line className="traffic-chart__grid" x1="0" x2="100" y1="66" y2="66" />
        <path className="traffic-chart__area" d={`${line} L100,100 L0,100 Z`} />
        <path className="traffic-chart__line" d={line} />
        {secondary && secondary.length > 1 ? (
          <path className="traffic-chart__secondary" d={path(secondary, max)} />
        ) : null}
      </svg>
    </div>
  )
}
