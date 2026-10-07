import {
  Activity,
  Bug,
  Command,
  Construction,
  FileText,
  FileX,
  HelpCircle,
  ListTodo,
  Lock,
  MessagesSquare,
  Monitor,
  Package,
  Palette,
  ScrollText,
  ServerOff,
  Settings,
  ShieldCheck,
  UserCog,
  UserRound,
  UserX,
  Utensils,
  Wrench,
  Bell,
} from 'lucide-react'
import { ClerkLogo } from '@/assets/clerk-logo'
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
    {
      title: 'Template',
      items: [
        { title: 'Tasks', url: '/tasks', icon: ListTodo },
        { title: 'Apps', url: '/apps', icon: Package },
        { title: 'Chats', url: '/chats', badge: '3', icon: MessagesSquare },
        {
          title: 'Secured by Clerk',
          icon: ClerkLogo,
          items: [
            { title: 'Sign In', url: '/clerk/sign-in' },
            { title: 'Sign Up', url: '/clerk/sign-up' },
            { title: 'User Management', url: '/clerk/user-management' },
          ],
        },
        { title: 'Help Center', url: '/help-center', icon: HelpCircle },
      ],
    },
    {
      title: 'Template · Forms',
      items: [
        {
          title: 'Auth',
          icon: ShieldCheck,
          items: [
            { title: 'Sign In', url: '/sign-in' },
            { title: 'Sign In (2 Col)', url: '/sign-in-2' },
            { title: 'Sign Up', url: '/sign-up' },
            { title: 'Forgot Password', url: '/forgot-password' },
            { title: 'OTP', url: '/otp' },
          ],
        },
        {
          title: 'Settings',
          icon: Settings,
          items: [
            { title: 'Profile', url: '/settings', icon: UserCog },
            { title: 'Account', url: '/settings/account', icon: Wrench },
            { title: 'Appearance', url: '/settings/appearance', icon: Palette },
            {
              title: 'Notifications',
              url: '/settings/notifications',
              icon: Bell,
            },
            { title: 'Display', url: '/settings/display', icon: Monitor },
          ],
        },
        {
          title: 'Errors',
          icon: Bug,
          items: [
            { title: 'Unauthorized', url: '/401', icon: Lock },
            { title: 'Forbidden', url: '/403', icon: UserX },
            { title: 'Not Found', url: '/404', icon: FileX },
            {
              title: 'Internal Server Error',
              url: '/500',
              icon: ServerOff,
            },
            { title: 'Maintenance Error', url: '/503', icon: Construction },
          ],
        },
      ],
    },
  ],
}
