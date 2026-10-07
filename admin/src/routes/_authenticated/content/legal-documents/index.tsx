import { createFileRoute } from '@tanstack/react-router'
import { requirePermission } from '@/lib/permissions'
import { LegalDocuments } from '@/features/legal-documents'

export const Route = createFileRoute(
  '/_authenticated/content/legal-documents/'
)({
  beforeLoad: () => requirePermission('content:read'),
  component: LegalDocuments,
})
