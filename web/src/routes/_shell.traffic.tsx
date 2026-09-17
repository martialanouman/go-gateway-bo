import { createFileRoute } from '@tanstack/react-router'
import { PendingScreen } from '~/components/pending-screen'

export const Route = createFileRoute('/_shell/traffic')({
  component: () => <PendingScreen to="/traffic" />,
})
