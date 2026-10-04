import { type ComponentPropsWithoutRef, type ReactNode, type Ref, useId } from 'react'

export type CardProps = Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  readonly title: ReactNode
  readonly subtitle?: ReactNode
  readonly actions?: ReactNode
  /** Sans marge intérieure : une table va jusqu'aux bords de la carte. */
  readonly flush?: boolean
  /** Pour y poser le focus quand la carte remplace ce qui le portait. */
  readonly titleRef?: Ref<HTMLHeadingElement>
}

export function Card({
  title,
  subtitle,
  actions,
  flush = false,
  titleRef,
  className,
  children,
  ...rest
}: CardProps) {
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className={['ui-card', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <div className="ui-card__head">
        <div>
          <h2
            className="ui-card__title"
            id={titleId}
            ref={titleRef}
            tabIndex={titleRef === undefined ? undefined : -1}
          >
            {title}
          </h2>
          {subtitle === undefined ? null : <p className="ui-card__sub">{subtitle}</p>}
        </div>
        {actions === undefined ? null : <div className="ui-card__actions">{actions}</div>}
      </div>
      <div
        className={['ui-card__body', flush ? 'ui-card__body--flush' : ''].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </section>
  )
}
