export { AdminModule } from './admin.module.js';
export { AdminAccessService } from './services/access.service.js';
export { AdminConsoleService } from './services/console.service.js';
export { AdminGuard } from './guards/admin.guard.js';
export { AdminPermissionGuard } from './guards/admin-permission.guard.js';
export { RequirePermission } from './decorators/require-permission.decorator.js';
export { ADMIN_PERMISSIONS, ADMIN_ROLE_PERMISSIONS } from './constants/permissions.js';
export type { AdminPermission } from './constants/permissions.js';
export { adminIdentityResponseSchema } from './dto/admin-identity.dto.js';
export type { AdminIdentityDto } from './dto/admin-identity.dto.js';
export {
  adminMetricsOverviewResponseSchema,
} from './dto/admin-metrics.dto.js';
export type { AdminMetricsOverviewDto } from './dto/admin-metrics.dto.js';
export {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserSummarySchema,
} from './dto/admin-users.dto.js';
export type {
  AdminUserListQueryDto,
  AdminUserListResponseDto,
  AdminUserSummaryDto,
} from './dto/admin-users.dto.js';
export {
  adminAuditLogListQuerySchema,
  adminAuditLogListResponseSchema,
} from './dto/admin-audit-logs.dto.js';
export type { AdminAuditLogListQueryDto } from './dto/admin-audit-logs.dto.js';
export type { AdminAuditLogListResponseDto } from './dto/admin-audit-logs.dto.js';
