import type { AdminRole } from '#generated/prisma/client.js';
import {
  QUEUE_NAME_LIST,
  queueReadPermission,
  queueWritePermission,
  type QueuePermission,
} from '../../../common/queue/queue-names.js';

/**
 * Non-queue permission points. Kept as a literal tuple so `AdminPermission`
 * still narrows to the exact base codes after the queue points are appended.
 */
const BASE_ADMIN_PERMISSIONS = [
  'metrics:read',
  'users:read',
  'users:write',
  'audit:read',
  'content:read',
  'content:write',
  'ops:read',
  'data:read',
  'data:write',
  'admin:manage',
] as const;

/**
 * Per-queue read points, derived from the canonical queue registry so a queue
 * added to `QUEUE_NAMES` automatically gains its permission point. The admin
 * queue panel (`/admin/queues`) enforces one point per queue rather than a
 * single coarse `queues:read`, so a role can be scoped to specific queues.
 */
const QUEUE_READ_PERMISSIONS: readonly QueuePermission[] = QUEUE_NAME_LIST.map(
  (name) => queueReadPermission(name),
);

/** Per-queue read + write points for every registered queue. */
const QUEUE_READ_WRITE_PERMISSIONS: readonly QueuePermission[] =
  QUEUE_NAME_LIST.flatMap((name) => [
    queueReadPermission(name),
    queueWritePermission(name),
  ]);

export const ADMIN_PERMISSIONS = [
  ...BASE_ADMIN_PERMISSIONS,
  ...QUEUE_READ_WRITE_PERMISSIONS,
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  ADMIN: [
    'metrics:read',
    'users:read',
    'users:write',
    'audit:read',
    'content:read',
    'content:write',
    'ops:read',
    'data:read',
    ...QUEUE_READ_WRITE_PERMISSIONS,
  ],
  EDITOR: ['content:read', 'content:write'],
  VIEWER: [
    'metrics:read',
    'users:read',
    'audit:read',
    'content:read',
    'ops:read',
    'data:read',
    ...QUEUE_READ_PERMISSIONS,
  ],
};

export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission,
): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}
