import { type LinkProps } from '@tanstack/react-router'

type User = {
  name: string
  email: string
  avatar: string
}

type Team = {
  name: string
  logo: React.ElementType
  plan: string
}

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /**
   * Absolute URL outside the SPA router (e.g. the bull-board queue panel at
   * `/admin/queues`, which the backend serves on the same origin). Rendered as
   * a plain anchor in a new tab instead of a router `<Link>`.
   */
  external?: string
  /**
   * External targets that cannot attach an `Authorization` header (bull-board
   * renders its own UI and API calls) authenticate from `?access_token=`
   * instead. Set this to have the SPA hand its access token over in the URL —
   * see `data/external-links.ts`.
   */
  externalAuth?: 'accessToken'
}

type NavSubItem = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  external?: never
  externalAuth?: never
}

type NavLink = BaseNavItem &
  (
    | { url: LinkProps['to'] | (string & {}); external?: never }
    | { external: string; url?: never }
  ) & { items?: never }

type NavCollapsible = BaseNavItem & {
  items: NavSubItem[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  items: NavItem[]
}

type SidebarData = {
  user: User
  teams: Team[]
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
