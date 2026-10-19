import {
  Activity,
  Cable,
  Command,
  Database,
  FileText,
  ListChecks,
  MessageSquareText,
  ScrollText,
  TrendingUp,
  UserRound,
  Utensils,
} from 'lucide-react'
import type { SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: '', email: '', avatar: '' },
  teams: [{ name: 'Lucent Admin', logo: Command, plan: 'Management console' }],
  navGroups: [
    {
      title: 'Administration',
      items: [
        { title: 'Overview', url: '/', icon: Activity },
        { title: 'Users', url: '/users', icon: UserRound },
        { title: 'Data browser', url: '/data', icon: Database },
        { title: 'Audit logs', url: '/audit-logs', icon: ScrollText },
      ],
    },
    {
      title: 'Metrics',
      items: [
        { title: 'Product funnel', url: '/metrics/funnel', icon: TrendingUp },
      ],
    },
    {
      title: 'Content',
      items: [
        {
          title: 'Legal documents',
          url: '/content/legal-documents',
          icon: FileText,
        },
        { title: 'Safety tips', url: '/content/safety-tips', icon: Utensils },
        {
          title: 'QA corpus',
          url: '/content/qa-chunks',
          icon: MessageSquareText,
        },
      ],
    },
    {
      title: 'Operations',
      items: [
        { title: 'Dependencies', url: '/dependencies', icon: Cable },
        // Served by the backend on the same origin, outside the SPA router.
        { title: 'Queues', external: '/admin/queues', icon: ListChecks },
      ],
    },
  ],
}
