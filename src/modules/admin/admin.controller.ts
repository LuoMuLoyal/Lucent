import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthSessionAdminService, CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { UserAdminService } from '../user/index.js';
import {
  ProblemDetailsDto,
  registerResponseSchema,
} from '../../common/index.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminPermissionGuard } from './guards/admin-permission.guard.js';
import { RequirePermission } from './decorators/require-permission.decorator.js';
import { AdminAccessService } from './infrastructure/persistence/access.service.js';
import { AdminAdminsService } from './infrastructure/persistence/admins.service.js';
import { AdminConsoleService } from './infrastructure/console/console.service.js';
import { AdminSharesService } from './infrastructure/persistence/shares.service.js';
import { AdminUserRelatedService } from './infrastructure/persistence/user-related.service.js';
import {
  adminUserRelatedQuerySchema,
  adminUserRelatedResponseSchema,
} from './application/ports/admin-data.js';
import type { AdminUserRelatedQueryDto } from './application/ports/admin-data.js';
import {
  adminAuditLogListQuerySchema,
  adminAuditLogListResponseSchema,
} from './application/ports/admin-audit-logs.js';
import {
  adminMetricsOverviewResponseSchema,
} from './adapters/http/dto/admin-metrics.js';
import { adminDependenciesResponseSchema } from './adapters/http/dto/admin-dependencies.js';
import {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserStatusUpdateSchema,
  adminUserSummarySchema,
} from './application/ports/admin-users.js';
import type { AdminAuditLogListQueryDto } from './application/ports/admin-audit-logs.js';
import type {
  AdminUserListQueryDto,
  AdminUserStatusUpdateDto,
} from './application/ports/admin-users.js';
import {
  adminAdminListResponseSchema,
  adminAdminRoleUpdateSchema,
  adminAdminSummarySchema,
} from './application/ports/admin-admins.js';
import type { AdminAdminRoleUpdateDto } from './application/ports/admin-admins.js';
import {
  adminLegalDocumentListSchema,
  adminLegalDocumentSchema,
  adminLegalDocumentUpdateSchema,
  adminQaChunkListQuerySchema,
  adminQaChunkListResponseSchema,
  adminQaChunkSchema,
  adminQaChunkUpdateSchema,
  adminSafetyTipCreateSchema,
  adminSafetyTipListSchema,
  adminSafetyTipSchema,
  adminSafetyTipUpdateSchema,
} from './adapters/http/dto/admin-content.js';
import type {
  AdminLegalDocumentUpdateDto,
  AdminQaChunkListQueryDto,
  AdminQaChunkUpdateDto,
  AdminSafetyTipCreateDto,
  AdminSafetyTipUpdateDto,
} from './adapters/http/dto/admin-content.js';
import { LegalDocumentsAdminService } from '../legal-documents/index.js';
import { SafetyTipsAdminService } from '../medicines/index.js';
import { QaChunksAdminService } from '../assistant/index.js';
import { adminIdentityResponseSchema } from './adapters/http/dto/admin-identity.js';
import type { AdminIdentityDto } from './adapters/http/dto/admin-identity.js';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminAccess: AdminAccessService,
    private readonly adminConsole: AdminConsoleService,
    private readonly admins: AdminAdminsService,
    private readonly userAdmin: UserAdminService,
    private readonly authSessions: AuthSessionAdminService,
    private readonly shares: AdminSharesService,
    private readonly userRelated: AdminUserRelatedService,
    private readonly legalDocuments: LegalDocumentsAdminService,
    private readonly safetyTips: SafetyTipsAdminService,
    private readonly qaChunks: QaChunksAdminService,
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

  @Get('dependencies')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('ops:read')
  @SerializeOptions({ schema: adminDependenciesResponseSchema })
  @ApiOperation({
    summary: 'Get enablement of the optional assistant sidecars',
  })
  @ApiResponse({
    status: 200,
    description: 'Sidecar enablement flags (flags only, no endpoints or keys).',
  })
  getDependencies() {
    return this.adminConsole.getDependencies();
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

  @Get('users/:id/related')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:read')
  @ApiOperation({ summary: "List a user's related records grouped by domain" })
  @ApiResponse({ status: 200, description: 'Related records grouped by domain.' })
  @ApiResponse({ status: 404, description: 'User not found.', type: ProblemDetailsDto })
  async getUserRelated(
    @Param('id', { schema: z.uuid() }) id: string,
    @Query({ schema: adminUserRelatedQuerySchema })
    query: AdminUserRelatedQueryDto,
  ) {
    const related = await this.userRelated.getForUser(id, query.limit);
    if (related === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    return related;
  }

  @Patch('users/:id/status')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:write')
  @SerializeOptions({ schema: adminUserSummarySchema })
  @ApiOperation({ summary: 'Activate or suspend a user account' })
  @ApiResponse({ status: 200, description: 'Updated user account summary.' })
  @ApiResponse({ status: 404, description: 'User not found.', type: ProblemDetailsDto })
  @ApiResponse({
    status: 403,
    description: 'Target is the caller or a super administrator.',
    type: ProblemDetailsDto,
  })
  async updateUserStatus(
    @CurrentUser() actor: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: adminUserStatusUpdateSchema })
    input: AdminUserStatusUpdateDto,
  ) {
    await this.assertUserMutable(actor.sub, id);
    const change = await this.userAdmin.setStatus(actor.sub, id, input.status);
    if (change === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (input.status === 'suspended') {
      await this.authSessions.revokeAllForUser(actor.sub, id);
    }
    const user = await this.adminConsole.getUser(id);
    if (user === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    return user;
  }

  @Delete('users/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Soft-delete a user account' })
  @ApiResponse({ status: 204, description: 'User soft-deleted.' })
  @ApiResponse({ status: 404, description: 'User not found.', type: ProblemDetailsDto })
  @ApiResponse({
    status: 403,
    description: 'Target is the caller or a super administrator.',
    type: ProblemDetailsDto,
  })
  @HttpCode(204)
  async deleteUser(
    @CurrentUser() actor: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
  ) {
    await this.assertUserMutable(actor.sub, id);
    const deleted = await this.userAdmin.softDelete(actor.sub, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    await this.authSessions.revokeAllForUser(actor.sub, id);
  }

  @Delete('users/:id/sessions/:sessionId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:write')
  @ApiOperation({ summary: "Revoke one of a user's sessions" })
  @ApiResponse({ status: 204, description: 'Session revoked.' })
  @ApiResponse({
    status: 404,
    description: 'Session not found for this user.',
    type: ProblemDetailsDto,
  })
  @HttpCode(204)
  async revokeUserSession(
    @CurrentUser() actor: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
    @Param('sessionId', { schema: z.uuid() }) sessionId: string,
  ) {
    const revoked = await this.authSessions.revokeSessionForUser(
      actor.sub,
      id,
      sessionId,
    );
    if (!revoked) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Session not found',
      });
    }
  }

  @Delete('users/:id/shares/:shareId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('users:write')
  @ApiOperation({ summary: "Revoke one of a user's clinic-summary share links" })
  @ApiResponse({ status: 204, description: 'Share revoked.' })
  @ApiResponse({
    status: 404,
    description: 'Share not found for this user.',
    type: ProblemDetailsDto,
  })
  @HttpCode(204)
  async revokeUserShare(
    @CurrentUser() actor: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
    @Param('shareId', { schema: z.uuid() }) shareId: string,
  ) {
    const revoked = await this.shares.revoke(actor.sub, id, shareId);
    if (!revoked) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Share not found',
      });
    }
  }

  @Get('admins')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('admin:manage')
  @SerializeOptions({ schema: adminAdminListResponseSchema })
  @ApiOperation({ summary: 'List administrator grants' })
  @ApiResponse({ status: 200, description: 'Administrator grants.' })
  async listAdmins() {
    return this.admins.list();
  }

  @Put('admins/:userId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('admin:manage')
  @SerializeOptions({ schema: adminAdminSummarySchema })
  @ApiOperation({ summary: 'Grant or change an administrator role' })
  @ApiResponse({ status: 200, description: 'Updated administrator grant.' })
  @ApiResponse({ status: 404, description: 'User not found.', type: ProblemDetailsDto })
  @ApiResponse({
    status: 403,
    description: 'Attempting to change the caller\'s own role.',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Refusing to demote the last super administrator.',
    type: ProblemDetailsDto,
  })
  async setAdminRole(
    @CurrentUser() actor: UserPayload,
    @Param('userId', { schema: z.uuid() }) userId: string,
    @Body({ schema: adminAdminRoleUpdateSchema })
    input: AdminAdminRoleUpdateDto,
  ) {
    const outcome = await this.admins.setRole(actor.sub, userId, input.role);
    if (outcome.status === 'self') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cannot change your own role',
      });
    }
    if (outcome.status === 'user_not_found') {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (outcome.status === 'last_super_admin') {
      throw new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'Cannot demote the last super administrator',
      });
    }
    return outcome.admin;
  }

  @Delete('admins/:userId')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('admin:manage')
  @ApiOperation({ summary: 'Revoke an administrator role' })
  @ApiResponse({ status: 204, description: 'Administrator grant removed.' })
  @ApiResponse({ status: 404, description: 'Grant not found.', type: ProblemDetailsDto })
  @ApiResponse({
    status: 403,
    description: 'Attempting to remove the caller\'s own role.',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Refusing to remove the last super administrator.',
    type: ProblemDetailsDto,
  })
  @HttpCode(204)
  async removeAdmin(
    @CurrentUser() actor: UserPayload,
    @Param('userId', { schema: z.uuid() }) userId: string,
  ) {
    const outcome = await this.admins.remove(actor.sub, userId);
    if (outcome === 'self') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cannot remove your own admin role',
      });
    }
    if (outcome === 'not_found') {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Administrator grant not found',
      });
    }
    if (outcome === 'last_super_admin') {
      throw new ConflictException({
        code: 'RESOURCE_CONFLICT',
        message: 'Cannot remove the last super administrator',
      });
    }
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
  // NOTE: JSON array body. The global serializer validates array items one by
  // one, so the ITEM schema belongs here — handing it the array schema makes
  // every item fail validation and the request answer 500. The array schema is
  // still what OpenAPI documents, via the registerResponseSchema call below.
  @SerializeOptions({ schema: adminLegalDocumentSchema })
  @ApiOperation({ summary: 'List legal documents for administration' })
  async listLegalDocuments() {
    return this.legalDocuments.list();
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
    return document;
  }

  @Get('content/safety-tips')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:read')
  // NOTE: JSON array body — item schema for outbound validation, array schema
  // for OpenAPI. See the legal-documents list above.
  @SerializeOptions({ schema: adminSafetyTipSchema })
  @ApiOperation({ summary: 'List medication safety tips for administration' })
  async listSafetyTips() {
    return this.safetyTips.list();
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
    return tip;
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
    return tip;
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

  @Get('content/qa-chunks')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:read')
  @SerializeOptions({ schema: adminQaChunkListResponseSchema })
  @ApiOperation({
    summary: "List the assistant's open medical Q&A corpus chunks",
  })
  @ApiResponse({ status: 200, description: 'Paginated QA corpus chunks.' })
  async listQaChunks(
    @Query({ schema: adminQaChunkListQuerySchema })
    query: AdminQaChunkListQueryDto,
  ) {
    return this.qaChunks.list(query);
  }

  @Put('content/qa-chunks/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('content:write')
  @SerializeOptions({ schema: adminQaChunkSchema })
  @ApiOperation({ summary: 'Update a QA corpus chunk' })
  @ApiResponse({ status: 200, description: 'Updated QA corpus chunk.' })
  async updateQaChunk(
    @CurrentUser() user: UserPayload,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: adminQaChunkUpdateSchema })
    input: AdminQaChunkUpdateDto,
  ) {
    const chunk = await this.qaChunks.update(user.sub, id, input);
    if (chunk === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'QA corpus chunk not found',
      });
    }
    return chunk;
  }

  /**
   * Guards the user-lifecycle writes: an administrator may not act on their own
   * account, and SUPER_ADMIN accounts are managed through the `/admin/admins`
   * role endpoints rather than through status/deletion.
   */
  private async assertUserMutable(
    actorId: string,
    targetId: string,
  ): Promise<void> {
    if (actorId === targetId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Cannot perform this action on your own account',
      });
    }
    if (await this.admins.isSuperAdmin(targetId)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'Super administrators are managed through the admin role endpoints',
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
  path: '/api/v1/admin/dependencies',
  method: 'get',
  componentName: 'AdminDependencies',
  schema: adminDependenciesResponseSchema,
  description: 'Sidecar enablement flags.',
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
  path: '/api/v1/admin/users/{id}/related',
  method: 'get',
  componentName: 'AdminUserRelated',
  schema: adminUserRelatedResponseSchema,
  description: "A user's related records grouped by domain.",
});
registerResponseSchema({
  path: '/api/v1/admin/users/{id}/status',
  method: 'patch',
  componentName: 'AdminUserSummary',
  schema: adminUserSummarySchema,
  description: 'Updated user account summary.',
});
registerResponseSchema({
  path: '/api/v1/admin/admins',
  method: 'get',
  componentName: 'AdminAdminListResponse',
  schema: adminAdminListResponseSchema,
  description: 'Administrator grants.',
});
registerResponseSchema({
  path: '/api/v1/admin/admins/{userId}',
  method: 'put',
  componentName: 'AdminAdminSummary',
  schema: adminAdminSummarySchema,
  description: 'Updated administrator grant.',
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
registerResponseSchema({
  path: '/api/v1/admin/content/qa-chunks',
  method: 'get',
  componentName: 'AdminQaChunkListResponse',
  schema: adminQaChunkListResponseSchema,
  description: 'Paginated QA corpus chunks.',
});
registerResponseSchema({
  path: '/api/v1/admin/content/qa-chunks/{id}',
  method: 'put',
  componentName: 'AdminQaChunk',
  schema: adminQaChunkSchema,
  description: 'Updated QA corpus chunk.',
});
