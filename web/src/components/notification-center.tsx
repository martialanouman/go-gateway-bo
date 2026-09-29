import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dot,
  type DotTone,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Popover,
  Skeleton,
} from '~/components/ui'
import { Refusal } from '~/lib/administration'
import { HttpError } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import {
  describeNotification,
  markNotificationRead,
  notificationsQueryOptions,
} from '~/lib/notifications'
import { usePermission } from '~/lib/permissions'

type NotificationEntry = components['schemas']['NotificationEntry']
type Severity = NotificationEntry['severity']

const SEVERITY: Readonly<Record<Severity, { readonly tone: DotTone; readonly label: string }>> = {
  info: { tone: 'info', label: 'Information' },
  warning: { tone: 'degraded', label: 'Avertissement' },
  critical: { tone: 'down', label: 'Critique' },
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function unreadLabel(count: number) {
  if (count === 0) return 'Notifications, aucune non lue'
  return `Notifications, ${count} ${count === 1 ? 'non lue' : 'non lues'}`
}

export function NotificationCenter() {
  const notifications = useInfiniteQuery(notificationsQueryOptions)
  const unread = notifications.data?.pages[0]?.unreadCount

  return (
    <Popover
      hint="Le centre garde les alertes reçues par le serveur ; une bascule ou une panne peut en laisser passer."
      label={unread === undefined ? 'Notifications' : unreadLabel(unread)}
      title="Notifications"
      trigger={
        <>
          <Icon name="bell" size={14} />
          {unread !== undefined && unread > 0 ? (
            <span className="notifications__count">{unread}</span>
          ) : null}
        </>
      }
    >
      <BillingNotice />
      <NotificationList />
    </Popover>
  )
}

function BillingNotice() {
  if (usePermission('billing:read')) return null

  return (
    <p className="notifications__notice">
      Les alertes de facturation n’apparaissent pas ici : elles exigent la permission{' '}
      <code>billing:read</code>.
    </p>
  )
}

function NotificationList() {
  const notifications = useInfiniteQuery(notificationsQueryOptions)
  const queryClient = useQueryClient()
  const mark = useMutation({
    mutationFn: markNotificationRead,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: notificationsQueryOptions.queryKey }),
  })

  const failure =
    notifications.error === null ? null : (
      <ErrorState
        onRetry={() => void notifications.refetch()}
        request={`GET /api/notifications · ${notifications.error instanceof HttpError ? notifications.error.status : 'réseau'}`}
        title="Impossible de lire les notifications"
      />
    )

  if (notifications.data === undefined) {
    return (
      failure ?? (
        <LoadingState label="Chargement des notifications">
          <Skeleton width={280} />
          <Skeleton width={200} />
        </LoadingState>
      )
    )
  }

  const entries = notifications.data.pages.flatMap((page) => page.items)

  return (
    <>
      {failure}
      <Refusal error={mark.error} />
      {entries.length === 0 ? (
        <EmptyState inline title="Aucune notification pour l’instant." />
      ) : (
        <ul className="notifications__list">
          {entries.map((notification) => {
            const { title, description } = describeNotification(notification)
            const severity = SEVERITY[notification.severity]
            return (
              <li
                className={[
                  'notifications__item',
                  notification.read ? 'notifications__item--read' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={notification.id}
              >
                <Dot tone={severity.tone} />
                <div className="notifications__body">
                  <p>
                    <span className="ui-visually-hidden">{severity.label} : </span>
                    <strong>{title}</strong>
                  </p>
                  <p>{description}</p>
                  <p className="notifications__meta">
                    <time dateTime={notification.createdAt}>{clock(notification.createdAt)}</time>
                    {notification.details === undefined ? null : (
                      <code>{notification.details.customerId}</code>
                    )}
                  </p>
                </div>
                {notification.read ? null : (
                  <Button
                    loading={mark.isPending && mark.variables === notification.id}
                    onClick={() => mark.mutate(notification.id)}
                    size="sm"
                    variant="link"
                  >
                    Marquer comme lue
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {notifications.hasNextPage ? (
        <Button
          loading={notifications.isFetchingNextPage}
          onClick={() => void notifications.fetchNextPage()}
          size="sm"
        >
          Afficher les suivantes
        </Button>
      ) : null}
    </>
  )
}
