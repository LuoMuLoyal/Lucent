import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { QaChunks } from '@/features/qa-chunks'

export const Route = createFileRoute('/_authenticated/content/qa-chunks/')({
  beforeLoad: () => requirePermission('content:read'),
  component: QaChunks,
})
