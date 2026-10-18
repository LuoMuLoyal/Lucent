import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { UserDetail } from '@/features/user-detail'

export const Route = createFileRoute('/_authenticated/users/$id')({
  beforeLoad: () => requirePermission('users:read'),
  component: UserDetail,
})
