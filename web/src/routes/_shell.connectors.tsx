import { createFileRoute } from '@tanstack/react-router'
import { PendingScreen } from '~/components/pending-screen'

export const Route = createFileRoute('/_shell/connectors')({
  component: () => <PendingScreen to="/connectors" />,
})
