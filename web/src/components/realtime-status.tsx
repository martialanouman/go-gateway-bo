import { StatusPill } from '~/components/ui'
import { useRealtimeSummary } from '~/lib/realtime'

const clock = (date: Date) =>
  date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

// La région live existe avant l'état qu'elle annonce : un lecteur d'écran n'annonce que le changement
// d'une région déjà présente, et la pilule interne n'en ouvre pas une seconde.
export function RealtimeStatus() {
  return (
    <span role="status">
      <Indicator />
    </span>
  )
}

// Un seul sujet périmé suffit : l'écran qui le lit montre une donnée ancienne, quel que soit le reste.
function Indicator() {
  const { phase, topics: subscribed } = useRealtimeSummary()
  // Un sujet refusé ne recevra jamais de statut : le compter figerait l'indicateur.
  const topics = subscribed.filter((topic) => topic.error === undefined)

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
    return <StatusPill announce={false} kind="link" label="En direct" live state="up" />
  }
  // Première ouverture ou reprise dans la tolérance : les deux sont une connexion en cours.
  return <StatusPill kind="link" label="Connexion en cours" state="reconnecting" />
}
