export { AdminModule } from './admin.module.js';
export { AdminAccessService } from './infrastructure/persistence/access.service.js';
export { AdminConsoleService } from './infrastructure/console/console.service.js';
export { AdminGuard } from './guards/admin.guard.js';
export { AdminPermissionGuard } from './guards/admin-permission.guard.js';
export { RequirePermission } from './decorators/require-permission.decorator.js';
export { ADMIN_PERMISSIONS, ADMIN_ROLE_PERMISSIONS } from './constants/permissions.js';
export type { AdminPermission } from './constants/permissions.js';
export { adminIdentityResponseSchema } from './adapters/http/dto/admin-identity.js';
export type { AdminIdentityDto } from './adapters/http/dto/admin-identity.js';
export {
  adminMetricsOverviewResponseSchema,
} from './adapters/http/dto/admin-metrics.js';
export type { AdminMetricsOverviewDto } from './adapters/http/dto/admin-metrics.js';
export {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserSummarySchema,
} from './application/ports/admin-users.js';
export type {
  AdminUserListQueryDto,
  AdminUserListResponseDto,
  AdminUserSummaryDto,
} from './application/ports/admin-users.js';
export {
  adminAuditLogListQuerySchema,
  adminAuditLogListResponseSchema,
} from './application/ports/admin-audit-logs.js';
export type { AdminAuditLogListQueryDto } from './application/ports/admin-audit-logs.js';
export type { AdminAuditLogListResponseDto } from './application/ports/admin-audit-logs.js';
