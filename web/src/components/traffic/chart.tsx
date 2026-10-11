import { type KeyboardEvent, type MouseEvent, useId, useState } from 'react'
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
  describe,
}: {
  readonly label: string
  readonly primary: readonly number[]
  readonly secondary?: readonly number[]
  readonly height?: number
  readonly tone?: 'warning'
  /** Les lignes de l'infobulle d'une tranche ; sans elle, le graphique n'est pas interactif. */
  readonly describe?: (index: number) => readonly string[]
}) {
  const [active, setActive] = useState<number | null>(null)
  const tooltipId = useId()
  if (primary.length < 2) return <div aria-label={label} role="img" style={{ height }} />
  const peak = Math.max(...primary, ...(secondary ?? []))
  const max = (peak > 0 ? peak : 1) * 1.14
  const line = path(primary, max)
  const last = primary.length - 1
  const clamp = (index: number) => Math.min(last, Math.max(0, index))
  // Un relevé peut raccourcir la série sous une infobulle ouverte.
  const shown = describe === undefined || active === null ? null : clamp(active)

  const point = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) setActive(clamp(Math.round(((event.clientX - box.left) / box.width) * last)))
  }
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') return setActive(null)
    const from = shown ?? last
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: last }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setActive(clamp(next))
  }
  const interaction =
    describe === undefined
      ? {}
      : {
          tabIndex: 0,
          onBlur: () => setActive(null),
          onFocus: () => setActive(last),
          onKeyDown: step,
          onMouseLeave: () => setActive(null),
          onMouseMove: point,
          'aria-describedby': shown === null ? undefined : tooltipId,
        }
  const left = shown === null ? undefined : `${(shown / last) * 100}%`

  return (
    <div className="traffic-chart-frame" style={{ height }}>
      <div aria-label={label} className="traffic-chart-frame__plot" role="img" {...interaction}>
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
      {shown === null || describe === undefined ? null : (
        <>
          <span aria-hidden="true" className="traffic-chart__guide" style={{ left }} />
          <div
            className={`ui-tooltip traffic-tooltip${shown > last / 2 ? ' traffic-tooltip--before' : ''}`}
            id={tooltipId}
            role="status"
            style={{ left }}
          >
            {describe(shown).map((text) => (
              <div key={text}>{text}</div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
