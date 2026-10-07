import { Command, LayoutDashboard, Users } from 'lucide-react'
import type { SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: { name: '', email: '', avatar: '' },
  teams: [{ name: 'Lucent Admin', logo: Command, plan: 'Management console' }],
  navGroups: [
    {
      title: 'Administration',
      items: [
        { title: 'Overview', url: '/', icon: LayoutDashboard },
        { title: 'Users', url: '/users', icon: Users },
      ],
    },
  ],
}
