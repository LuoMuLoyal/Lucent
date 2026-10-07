import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser } from '../../auth/index.js';
import type { UserPayload } from '../../auth/index.js';
import {
  ProblemDetailsDto,
  registerResponseSchema,
} from '../../../common/index.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { AdminPermissionGuard } from '../guards/admin-permission.guard.js';
import { RequirePermission } from '../decorators/require-permission.decorator.js';
import { AdminAccessService } from '../services/access.service.js';
import { AdminConsoleService } from '../services/console.service.js';
import {
  adminAuditLogListQuerySchema,
  adminAuditLogListResponseSchema,
} from '../dto/admin-audit-logs.dto.js';
import {
  adminMetricsOverviewResponseSchema,
} from '../dto/admin-metrics.dto.js';
import {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserSummarySchema,
} from '../dto/admin-users.dto.js';
import type { AdminAuditLogListQueryDto } from '../dto/admin-audit-logs.dto.js';
import type { AdminUserListQueryDto } from '../dto/admin-users.dto.js';
import { adminIdentityResponseSchema } from '../dto/admin-identity.dto.js';
import type { AdminIdentityDto } from '../dto/admin-identity.dto.js';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminAccess: AdminAccessService,
    private readonly adminConsole: AdminConsoleService,
  ) {}

  @Get('me')
  @SerializeOptions({ schema: adminIdentityResponseSchema })
  @ApiOperation({ summary: 'Get the current administrator identity and permissions' })
  @ApiResponse({ status: 200, description: 'Current administrator identity.' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token.',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not have an AdminUser role.',
    type: ProblemDetailsDto,
  })
  async getMe(@CurrentUser() user: UserPayload): Promise<AdminIdentityDto> {
    const identity = await this.adminAccess.getIdentity(user.sub);
    if (identity === null) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return identity;
  }

  @Get('metrics/overview')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('metrics:read')
  @SerializeOptions({ schema: adminMetricsOverviewResponseSchema })
  @ApiOperation({ summary: 'Get aggregate admin dashboard metrics' })
  @ApiResponse({ status: 200, description: 'Aggregate admin dashboard metrics.' })
  async getMetricsOverview() {
    return this.adminConsole.getOverview();
  }

  @Get('users')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:read')
  @SerializeOptions({ schema: adminUserListResponseSchema })
  @ApiOperation({ summary: 'List user account summaries' })
  @ApiResponse({ status: 200, description: 'Paginated user account summaries.' })
  async listUsers(
    @Query({ schema: adminUserListQuerySchema }) query: AdminUserListQueryDto,
  ) {
    return this.adminConsole.listUsers(query);
  }

  @Get('users/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:read')
  @SerializeOptions({ schema: adminUserSummarySchema })
  @ApiOperation({ summary: 'Get one user account summary' })
  @ApiResponse({ status: 200, description: 'User account summary.' })
  @ApiResponse({ status: 404, description: 'User not found.', type: ProblemDetailsDto })
  async getUser(@Param('id', { schema: z.uuid() }) id: string) {
    const user = await this.adminConsole.getUser(id);
    if (user === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    return user;
  }

  @Get('audit-logs')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('audit:read')
  @SerializeOptions({ schema: adminAuditLogListResponseSchema })
  @ApiOperation({ summary: 'List security audit log entries' })
  @ApiResponse({ status: 200, description: 'Paginated security audit logs.' })
  async listAuditLogs(
    @Query({ schema: adminAuditLogListQuerySchema })
    query: AdminAuditLogListQueryDto,
  ) {
    return this.adminConsole.listAuditLogs(query);
  }
}

registerResponseSchema({
  path: '/api/v1/admin/metrics/overview',
  method: 'get',
  componentName: 'AdminMetricsOverview',
  schema: adminMetricsOverviewResponseSchema,
  description: 'Aggregate admin dashboard metrics.',
});
registerResponseSchema({
  path: '/api/v1/admin/users',
  method: 'get',
  componentName: 'AdminUserListResponse',
  schema: adminUserListResponseSchema,
  description: 'Paginated user account summaries.',
});
registerResponseSchema({
  path: '/api/v1/admin/users/{id}',
  method: 'get',
  componentName: 'AdminUserSummary',
  schema: adminUserSummarySchema,
  description: 'User account summary.',
});
registerResponseSchema({
  path: '/api/v1/admin/audit-logs',
  method: 'get',
  componentName: 'AdminAuditLogListResponse',
  schema: adminAuditLogListResponseSchema,
  description: 'Paginated security audit log entries.',
});
