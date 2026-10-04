import type { ReactNode } from 'react'
import { Icon } from './icon'

export type BannerProps = {
  readonly title: ReactNode
  /** Ce que la situation veut dire, pas seulement qu'elle existe (charte, `Banner.prompt.md`). */
  readonly children: ReactNode
}

export function Banner({ title, children }: BannerProps) {
  return (
    <div className="ui-banner" role="alert">
      <span className="ui-banner__icon">
        <Icon name="bang" />
      </span>
      <div className="ui-banner__body">
        <span className="ui-banner__title">{title}</span>
        <span className="ui-banner__text">{children}</span>
      </div>
    </div>
  )
}
