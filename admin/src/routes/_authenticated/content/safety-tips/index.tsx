import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { SafetyTips } from '@/features/safety-tips'

export const Route = createFileRoute('/_authenticated/content/safety-tips/')({
  beforeLoad: () => requirePermission('content:read'),
  component: SafetyTips,
})
