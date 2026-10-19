import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { Dependencies } from '@/features/dependencies'

export const Route = createFileRoute('/_authenticated/dependencies/')({
  beforeLoad: () => requirePermission('ops:read'),
  component: Dependencies,
})
