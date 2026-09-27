import { useToast } from '~/components/ui'
import type { components } from '~/lib/api.gen'
import { usePermission } from '~/lib/permissions'
import { useTopic } from '~/lib/realtime'

type BillingAlert = components['schemas']['BillingAlert']

export function BillingAlertToasts() {
  const allowed = usePermission('billing:read')
  const toast = useToast()
  useTopic(allowed ? 'billing.alerts' : null, (alert) => toast(billingAlertToast(alert)))
  return null
}

// Le contrat ne décrit aucune conséquence d'une alerte : la copie nomme le fait, rien de plus.
export function billingAlertToast(alert: BillingAlert) {
  const owner = balanceOwner(alert)
  return {
    ...(alert.alert === 'mo_floor_reached'
      ? {
          title: 'Plancher de facturation MO atteint',
          description: `Le solde ${owner} est à ${alert.balance.toLocaleString('fr-FR')} crédits.`,
        }
      : {
          title: 'Alerte de facturation',
          description: `Alerte « ${alert.alert} » sur le solde ${owner}.`,
        }),
    severity: 'warning',
    source: 'bff',
  } as const
}

// `BalanceScope` de l'API Admin ; le BFF le type en chaîne libre, d'où le repli brut.
function balanceOwner({ ownerType, ownerId, customerId }: BillingAlert) {
  if (ownerType === 'customer') return `du client ${customerId}`
  if (ownerType === 'smpp_account') return `du compte SMPP ${ownerId} du client ${customerId}`
  return `${ownerType} ${ownerId} du client ${customerId}`
}
