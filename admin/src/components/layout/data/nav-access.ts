import type { NavGroup } from '../types'

/**
 * Maps the administration surface to the permission Lucent issues from
 * `GET /admin/me`. Navigation is hidden without the permission, but every
 * endpoint re-checks it server-side.
 */
const requiredPermissionByUrl: Record<string, string> = {
  '/': 'metrics:read',
  '/users': 'users:read',
  '/audit-logs': 'audit:read',
  '/content/legal-documents': 'content:read',
  '/content/safety-tips': 'content:read',
}

/** 内部使用：URL → 所需权限（导出面由 `filterNavGroups` 提供）。 */
function permissionForUrl(url: string): string | undefined {
  return requiredPermissionByUrl[url]
}

export function filterNavGroups(
  groups: NavGroup[],
  permissions: string[]
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const url = 'url' in item ? item.url : undefined
        if (url === undefined) return true
        const required = permissionForUrl(String(url))
        return required === undefined || permissions.includes(required)
      }),
    }))
    .filter((group) => group.items.length > 0)
}
