export { AdminModule } from './admin.module.js';
export { AdminAccessService } from './services/access.service.js';
export { AdminGuard } from './guards/admin.guard.js';
export { AdminPermissionGuard } from './guards/admin-permission.guard.js';
export { RequirePermission } from './decorators/require-permission.decorator.js';
export { ADMIN_PERMISSIONS, ADMIN_ROLE_PERMISSIONS } from './constants/permissions.js';
export type { AdminPermission } from './constants/permissions.js';
