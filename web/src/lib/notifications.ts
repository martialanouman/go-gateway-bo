import { infiniteQueryOptions } from '@tanstack/react-query'
import type { ToastSource } from '~/components/ui'
import { orRefusal } from './administration'
import { api, HttpError } from './api'
import type { components } from './api.gen'

type Notification = components['schemas']['Notification']
type NotificationEntry = components['schemas']['NotificationEntry']
type BillingAlert = components['schemas']['BillingAlert']

/** Une seule rédaction pour le toast et le centre : une formulation corrigée vaut pour tout l'historique. */
export function describeNotification(notification: Notification | NotificationEntry) {
  if (notification.kind === 'billing_alert' && notification.details !== undefined) {
    return describeBillingAlert(notification.details)
  }

  return { title: 'Alerte', description: notification.message ?? '' }
}

// Le contrat ne décrit aucune conséquence d'une alerte : la copie nomme le fait, rien de plus.
function describeBillingAlert(alert: BillingAlert) {
  const owner = balanceOwner(alert)
  if (alert.alert === 'mo_floor_reached') {
    return {
      title: 'Plancher de facturation MO atteint',
      description: `Le solde ${owner} est à ${alert.balance.toLocaleString('fr-FR')} crédits.`,
    }
  }

  return {
    title: 'Alerte de facturation',
    description: `Alerte « ${alert.alert} » sur le solde ${owner}.`,
  }
}

// `BalanceScope` de l'API Admin ; le BFF le type en chaîne libre, d'où le repli brut.
function balanceOwner({ ownerType, ownerId, customerId }: BillingAlert) {
  if (ownerType === 'customer') return `du client ${customerId}`
  if (ownerType === 'smpp_account') return `du compte ${ownerId} du client ${customerId}`
  return `${ownerType} ${ownerId} du client ${customerId}`
}

export function toastSource(source: Notification['source']): ToastSource {
  return source === 'alertmanager' ? 'alertmanager' : 'bff'
}

// `retry: false` : une panne se rend à l'opérateur, qui a « Réessayer » sous la main.
export const notificationsQueryOptions = infiniteQueryOptions({
  queryKey: ['notifications'],
  queryFn: async ({ pageParam }) => {
    const { data, response } = await api.GET('/notifications', {
      params: { query: pageParam === undefined ? {} : { cursor: pageParam } },
    })
    if (data === undefined) throw new HttpError(response.status)
    return data
  },
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (page) => page.nextCursor,
  retry: false,
})

export async function markNotificationRead(notificationId: string) {
  await orRefusal(
    api.POST('/notifications/{notificationId}/read', { params: { path: { notificationId } } }),
    "La notification n'a pas été marquée comme lue : le serveur n'a pas répondu. Elle reste non " +
      'lue ; réessayer la marque.',
  )
}
