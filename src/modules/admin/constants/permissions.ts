import type { AdminRole } from '#generated/prisma/client.js';

export const ADMIN_PERMISSIONS = [
  'metrics:read',
  'users:read',
  'audit:read',
  'content:read',
  'content:write',
  'ops:read',
  'admin:manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  ADMIN: [
    'metrics:read',
    'users:read',
    'audit:read',
    'content:read',
    'content:write',
    'ops:read',
  ],
  EDITOR: ['content:read', 'content:write'],
  VIEWER: [
    'metrics:read',
    'users:read',
    'audit:read',
    'content:read',
    'ops:read',
  ],
};

export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}
