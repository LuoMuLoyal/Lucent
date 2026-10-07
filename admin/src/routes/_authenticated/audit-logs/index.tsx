import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { AuditLogs } from '@/features/audit-logs'

export const Route = createFileRoute('/_authenticated/audit-logs/')({
  beforeLoad: () => requirePermission('audit:read'),
  component: AuditLogs,
})
