import { DATA_RESOURCE_KEYS } from '@/config/data-resources'
import type { AccessControlProvider } from '@refinedev/core'
import { useAuthStore } from '@/stores/auth-store'

const permissionsByResource: Record<string, Record<string, string>> = {
  metrics: { list: 'metrics:read', show: 'metrics:read' },
  users: { list: 'users:read', show: 'users:read' },
  'audit-logs': { list: 'audit:read' },
  'legal-documents': {
    list: 'content:read',
    show: 'content:read',
    edit: 'content:write',
  },
  'safety-tips': {
    list: 'content:read',
    show: 'content:read',
    create: 'content:write',
    edit: 'content:write',
    delete: 'content:write',
  },
  'qa-chunks': {
    list: 'content:read',
    edit: 'content:write',
  },
}

/**
 * Generic data-layer tables all share two permission points: reads need
 * `data:read`, writes need `data:write`. Explicit entries above win, so the
 * hand-built screens keep their narrower permissions.
 */
function dataResourcePermission(
  resource: string,
  action: string
): string | undefined {
  if (!DATA_RESOURCE_KEYS.has(resource)) return undefined
  return action === 'create' || action === 'edit' || action === 'delete'
    ? 'data:write'
    : 'data:read'
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const key = resource ?? ''
    const required =
      permissionsByResource[key]?.[action] ??
      dataResourcePermission(key, action)
    if (!required) return { can: false, reason: 'Unknown permission' }

    const granted = useAuthStore.getState().auth.user?.permissions ?? []
    return {
      can: granted.includes(required),
      reason: granted.includes(required) ? undefined : `Requires ${required}`,
    }
  },
}
