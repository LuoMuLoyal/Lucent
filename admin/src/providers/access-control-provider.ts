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
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const required = permissionsByResource[resource ?? '']?.[action]
    if (!required) return { can: false, reason: 'Unknown permission' }

    const granted = useAuthStore.getState().auth.user?.permissions ?? []
    return {
      can: granted.includes(required),
      reason: granted.includes(required) ? undefined : `Requires ${required}`,
    }
  },
}
