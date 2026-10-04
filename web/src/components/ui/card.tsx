import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react'

export type CardProps = Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  readonly title?: ReactNode
  readonly subtitle?: ReactNode
  readonly actions?: ReactNode
  /** Sans marge intérieure : une table va jusqu'aux bords de la carte. */
  readonly flush?: boolean
}

export function Card({
  title,
  subtitle,
  actions,
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  const titleId = useId()

  return (
    <section
      aria-labelledby={title === undefined ? undefined : titleId}
      className={['ui-card', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {title === undefined && actions === undefined ? null : (
        <header className="ui-card__head">
          <div>
            {title === undefined ? null : (
              <h2 className="ui-card__title" id={titleId}>
                {title}
              </h2>
            )}
            {subtitle === undefined ? null : <p className="ui-card__sub">{subtitle}</p>}
          </div>
          {actions === undefined ? null : <div className="ui-card__actions">{actions}</div>}
        </header>
      )}
      <div
        className={['ui-card__body', flush ? 'ui-card__body--flush' : ''].filter(Boolean).join(' ')}
      >
        {children}
      </div>
    </section>
  )
}
