import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { DataBrowser } from '@/features/data-browser'

const dataSearchSchema = z.object({
  resource: z.string().optional().catch(undefined),
  q: z.string().optional().catch(''),
  userId: z.string().optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(1),
})

export const Route = createFileRoute('/_authenticated/data/')({
  beforeLoad: () => requirePermission('data:read'),
  validateSearch: dataSearchSchema,
  component: DataBrowser,
})
