import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { Users } from '@/features/users'

const usersSearchSchema = z.object({
  q: z.string().optional().catch(''),
  status: z.enum(['active', 'suspended']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/users/')({
  beforeLoad: () => requirePermission('users:read'),
  validateSearch: usersSearchSchema,
  component: Users,
})
