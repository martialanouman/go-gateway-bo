import { createFileRoute } from '@tanstack/react-router'
import { TrafficScreen } from '~/components/traffic/traffic-screen'

export const Route = createFileRoute('/_shell/traffic')({ component: TrafficScreen })
