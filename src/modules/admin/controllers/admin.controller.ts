import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
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
import {
  adminLegalDocumentListSchema,
  adminLegalDocumentSchema,
  adminLegalDocumentUpdateSchema,
  adminSafetyTipCreateSchema,
  adminSafetyTipListSchema,
  adminSafetyTipSchema,
  adminSafetyTipUpdateSchema,
} from '../dto/admin-content.dto.js';
import type {
  AdminLegalDocumentUpdateDto,
  AdminSafetyTipCreateDto,
  AdminSafetyTipUpdateDto,
} from '../dto/admin-content.dto.js';
import { LegalDocumentsAdminService } from '../../legal-documents/index.js';
import { SafetyTipsAdminService } from '../../medicines/index.js';
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
    private readonly legalDocuments: LegalDocumentsAdminService,
    private readonly safetyTips: SafetyTipsAdminService,
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

  @Get('content/legal-documents')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:read')
  @SerializeOptions({ schema: adminLegalDocumentListSchema })
  @ApiOperation({ summary: 'List legal documents for administration' })
  async listLegalDocuments() {
    const documents = await this.legalDocuments.list();
    return documents.map((document) => ({
      ...document,
      updatedAt: document.updatedAt.toISOString(),
    }));
  }

  @Put('content/legal-documents/:docType')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:write')
  @SerializeOptions({ schema: adminLegalDocumentSchema })
  @ApiOperation({ summary: 'Update a legal document' })
  async updateLegalDocument(
    @CurrentUser() user: UserPayload,
    @Param('docType', { schema: z.string().trim().min(1).max(100) })
    docType: string,
    @Body({ schema: adminLegalDocumentUpdateSchema })
    input: AdminLegalDocumentUpdateDto,
  ) {
    const document = await this.legalDocuments.update(user.sub, docType, input);
    if (document === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Legal document not found',
      });
    }
    return { ...document, updatedAt: document.updatedAt.toISOString() };
  }

  @Get('content/safety-tips')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:read')
  @SerializeOptions({ schema: adminSafetyTipListSchema })
  @ApiOperation({ summary: 'List medication safety tips for administration' })
  async listSafetyTips() {
    const tips = await this.safetyTips.list();
    return tips.map((tip) => ({ ...tip, updatedAt: tip.updatedAt.toISOString() }));
  }

  @Post('content/safety-tips')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:write')
  @SerializeOptions({ schema: adminSafetyTipSchema })
  @ApiOperation({ summary: 'Create a medication safety tip' })
  async createSafetyTip(
    @CurrentUser() user: UserPayload,
    @Body({ schema: adminSafetyTipCreateSchema }) input: AdminSafetyTipCreateDto,
  ) {
    const tip = await this.safetyTips.create(user.sub, input);
    return { ...tip, updatedAt: tip.updatedAt.toISOString() };
  }

  @Put('content/safety-tips/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:write')
  @SerializeOptions({ schema: adminSafetyTipSchema })
  @ApiOperation({ summary: 'Update a medication safety tip' })
  async updateSafetyTip(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: adminSafetyTipUpdateSchema }) input: AdminSafetyTipUpdateDto,
  ) {
    const tip = await this.safetyTips.update(user.sub, id, input);
    if (tip === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Safety tip not found',
      });
    }
    return { ...tip, updatedAt: tip.updatedAt.toISOString() };
  }

  @Delete('content/safety-tips/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:write')
  @ApiOperation({ summary: 'Delete a medication safety tip' })
  @ApiResponse({ status: 204, description: 'Safety tip deleted.' })
  @HttpCode(204)
  async deleteSafetyTip(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
  ) {
    const deleted = await this.safetyTips.remove(user.sub, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Safety tip not found',
      });
    }
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
registerResponseSchema({
  path: '/api/v1/admin/content/legal-documents',
  method: 'get',
  componentName: 'AdminLegalDocumentList',
  schema: adminLegalDocumentListSchema,
  description: 'Legal document administration list.',
});
registerResponseSchema({
  path: '/api/v1/admin/content/legal-documents/{docType}',
  method: 'put',
  componentName: 'AdminLegalDocument',
  schema: adminLegalDocumentSchema,
  description: 'Updated legal document.',
});
registerResponseSchema({
  path: '/api/v1/admin/content/safety-tips',
  method: 'get',
  componentName: 'AdminSafetyTipList',
  schema: adminSafetyTipListSchema,
  description: 'Medication safety tips administration list.',
});
registerResponseSchema({
  path: '/api/v1/admin/content/safety-tips',
  method: 'post',
  componentName: 'AdminSafetyTip',
  schema: adminSafetyTipSchema,
  description: 'Created medication safety tip.',
});
registerResponseSchema({
  path: '/api/v1/admin/content/safety-tips/{id}',
  method: 'put',
  componentName: 'AdminSafetyTip',
  schema: adminSafetyTipSchema,
  description: 'Updated medication safety tip.',
});
