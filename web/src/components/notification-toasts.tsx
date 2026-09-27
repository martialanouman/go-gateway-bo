import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '~/components/ui'
import { describeNotification, notificationsQueryOptions, toastSource } from '~/lib/notifications'
import { useTopic } from '~/lib/realtime'

// Abonné sans condition : le hub ne remet une trame qu'à qui détient la permission de sa source.
export function NotificationToasts() {
  const toast = useToast()
  const queryClient = useQueryClient()
  useTopic('notifications', (notification) => {
    void queryClient.invalidateQueries({ queryKey: notificationsQueryOptions.queryKey })
    toast({
      ...describeNotification(notification),
      severity: notification.severity,
      source: toastSource(notification.source),
    })
  })
  return null
}
