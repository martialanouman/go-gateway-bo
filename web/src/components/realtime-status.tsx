import { StatusPill } from '~/components/ui'
import { useRealtimeSummary } from '~/lib/realtime'

const clock = (date: Date) =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

// Un seul sujet périmé suffit : l'écran qui le lit montre une donnée ancienne, quel que soit le reste.
export function RealtimeStatus() {
  const { phase, topics } = useRealtimeSummary()

  if (topics.length === 0) return null
  if (phase === 'ended') return <StatusPill kind="link" label="Session terminée" state="down" />

  const stale = topics.filter((topic) => topic.isStale)
  if (stale.length > 0) {
    // `stale` sans `since` : le flux n'a jamais été joint, il n'y a pas d'heure à donner.
    const since = stale.flatMap((topic) => (topic.since ? [topic.since.getTime()] : []))
    return (
      <StatusPill
        kind="link"
        label="Données périmées"
        meta={since.length === 0 ? undefined : `depuis ${clock(new Date(Math.min(...since)))}`}
        state="reconnecting"
      />
    )
  }

  if (topics.every((topic) => topic.isLive)) {
    return <StatusPill kind="link" label="En direct" live state="up" />
  }
  // Première ouverture ou reprise dans la tolérance : les deux sont une connexion en cours.
  return <StatusPill kind="link" label="Connexion en cours" state="reconnecting" />
}
