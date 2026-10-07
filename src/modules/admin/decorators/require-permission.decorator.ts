import { SetMetadata } from '@nestjs/common';
import type { AdminPermission } from '../constants/permissions.js';

export const REQUIRED_ADMIN_PERMISSION = 'admin:required-permission';

export function RequirePermission(permission: AdminPermission) {
  return SetMetadata(REQUIRED_ADMIN_PERMISSION, permission);
}
