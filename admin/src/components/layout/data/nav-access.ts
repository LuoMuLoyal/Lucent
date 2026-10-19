import type { NavGroup } from '../types'

/**
 * Maps the administration surface to the permission Lucent issues from
 * `GET /admin/me`. Navigation is hidden without the permission, but every
 * endpoint re-checks it server-side.
 *
 * A rule is either a single permission or a predicate over the granted set —
 * the queue panel needs the latter because each queue contributes its own
 * `queue:<name>:read` point (`common/queue/queue-names.ts`).
 */
type AccessRule = string | ((permissions: string[]) => boolean)

const accessRuleByUrl: Record<string, AccessRule> = {
  '/': 'metrics:read',
  '/metrics/funnel': 'metrics:read',
  '/users': 'users:read',
  '/data': 'data:read',
  '/audit-logs': 'audit:read',
  '/content/legal-documents': 'content:read',
  '/content/safety-tips': 'content:read',
  '/content/qa-chunks': 'content:read',
  '/dependencies': 'ops:read',
  '/admin/queues': hasAnyQueueReadPermission,
}

/** The bull-board panel is visible when at least one queue is readable. */
function hasAnyQueueReadPermission(permissions: string[]): boolean {
  return permissions.some((permission) => /^queue:.+:read$/.test(permission))
}

/** 内部使用：URL → 访问规则（导出面由 `filterNavGroups` 提供）。 */
function accessRuleForUrl(url: string): AccessRule | undefined {
  return accessRuleByUrl[url]
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
        const rule = accessRuleForUrl(String(url))
        if (rule === undefined) return true
        return typeof rule === 'string'
          ? permissions.includes(rule)
          : rule(permissions)
      }),
    }))
    .filter((group) => group.items.length > 0)
}
