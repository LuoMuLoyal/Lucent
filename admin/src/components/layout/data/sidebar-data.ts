import {
  Activity,
  FileText,
  ScrollText,
  UserRound,
  Utensils,
  Command,
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
        { title: 'Audit logs', url: '/audit-logs', icon: ScrollText },
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
      ],
    },
  ],
}
