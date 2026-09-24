import { EmptyState } from '~/components/ui'
import { MILESTONES, type NavPath, navEntry } from '~/lib/navigation'

/**
 * Une route déclarée dont l'écran n'est pas livré (§1.9) : elle nomme son jalon, jamais un blanc.
 * L'état **est** l'écran, d'où le `h1`.
 */
export function PendingScreen({ to }: { readonly to: NavPath }) {
  const { label, milestone } = navEntry(to)
  if (milestone === undefined) throw new Error(`${to} est livré : il n'a pas d'écran d'attente`)

  return (
    <div className="page">
      <EmptyState
        description={`Il arrive avec le jalon ${milestone} — ${MILESTONES[milestone]}. Cette adresse restera la sienne.`}
        title={`L’écran « ${label} » n’est pas encore livré`}
        titleAs="h1"
      />
    </div>
  )
}
