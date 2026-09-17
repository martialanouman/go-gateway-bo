import { createFileRoute } from '@tanstack/react-router'
import { PendingScreen } from '~/components/pending-screen'

export const Route = createFileRoute('/_shell/exact-routes')({
  component: () => <PendingScreen to="/exact-routes" />,
})
