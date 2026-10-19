import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { MetricsFunnel } from '@/features/metrics-funnel'

export const Route = createFileRoute('/_authenticated/metrics/funnel/')({
  beforeLoad: () => requirePermission('metrics:read'),
  component: MetricsFunnel,
})
