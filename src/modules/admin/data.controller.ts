import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ProblemDetailsDto,
  registerResponseSchema,
} from '../../common/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminPermissionGuard } from './guards/admin-permission.guard.js';
import { RequirePermission } from './decorators/require-permission.decorator.js';
import { AdminDataService } from './infrastructure/persistence/data.service.js';
import {
  getAdminResource,
  type AdminResource,
} from './constants/resource-registry.js';
import {
  adminResourceListQuerySchema,
  adminResourceListResponseSchema,
  adminResourceRowSchema,
  adminResourceWriteSchema,
} from './application/ports/admin-data.js';
import type {
  AdminResourceListQueryDto,
  AdminResourceWriteDto,
} from './application/ports/admin-data.js';

const resourceParamSchema = z.string().trim().min(1).max(80);
const rowIdParamSchema = z.string().trim().min(1).max(200);

/**
 * Generic admin data API (see `src/modules/admin/README.md`).
 *
 * Drives every registered Prisma table from `resource-registry.ts` instead of
 * one controller per table. Reads need `data:read`; writes need `data:write`
 * (SUPER_ADMIN only) and are refused for `readOnly` resources.
 */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminDataController {
  constructor(private readonly data: AdminDataService) {}

  @Get('data/:resource')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('data:read')
  @ApiOperation({ operationId: 'listAdminResourceRows', summary: 'List rows of a registered admin resource' })
  @ApiResponse({ status: 200, description: 'Paginated resource rows.' })
  @ApiResponse({
    status: 404,
    description: 'Unknown resource key.',
    type: ProblemDetailsDto,
  })
  async listResourceRows(
    @Param('resource', { schema: resourceParamSchema }) resource: string,
    @Query({ schema: adminResourceListQuerySchema })
    query: AdminResourceListQueryDto,
  ) {
    return this.data.list(this.resolve(resource), query);
  }

  @Get('data/:resource/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('data:read')
  @ApiOperation({ operationId: 'getAdminResourceRow', summary: 'Get one row of a registered admin resource' })
  @ApiResponse({ status: 200, description: 'Resource row.' })
  @ApiResponse({
    status: 404,
    description: 'Unknown resource key or row not found.',
    type: ProblemDetailsDto,
  })
  async getResourceRow(
    @Param('resource', { schema: resourceParamSchema }) resource: string,
    @Param('id', { schema: rowIdParamSchema }) id: string,
  ) {
    const row = await this.data.getOne(this.resolve(resource), id);
    if (row === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Row not found',
      });
    }
    return row;
  }

  @Post('data/:resource')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('data:write')
  @ApiOperation({ operationId: 'createAdminResourceRow', summary: 'Create a row of a registered admin resource' })
  @ApiResponse({ status: 201, description: 'Created resource row.' })
  @ApiResponse({
    status: 403,
    description: 'Resource is read-only or caller lacks data:write.',
    type: ProblemDetailsDto,
  })
  async createResourceRow(
    @CurrentUser() actor: UserPayload,
    @Param('resource', { schema: resourceParamSchema }) resource: string,
    @Body({ schema: adminResourceWriteSchema }) input: AdminResourceWriteDto,
  ) {
    return this.data.create(actor.sub, this.resolve(resource), input);
  }

  @Put('data/:resource/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('data:write')
  @ApiOperation({ operationId: 'updateAdminResourceRow', summary: 'Update a row of a registered admin resource' })
  @ApiResponse({ status: 200, description: 'Updated resource row.' })
  @ApiResponse({
    status: 404,
    description: 'Unknown resource key or row not found.',
    type: ProblemDetailsDto,
  })
  async updateResourceRow(
    @CurrentUser() actor: UserPayload,
    @Param('resource', { schema: resourceParamSchema }) resource: string,
    @Param('id', { schema: rowIdParamSchema }) id: string,
    @Body({ schema: adminResourceWriteSchema }) input: AdminResourceWriteDto,
  ) {
    const row = await this.data.update(
      actor.sub,
      this.resolve(resource),
      id,
      input,
    );
    if (row === null) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Row not found',
      });
    }
    return row;
  }

  @Delete('data/:resource/:id')
  @UseGuards(AdminPermissionGuard)
  @RequirePermission('data:write')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteAdminResourceRow', summary: 'Delete (or soft-delete) a row of a registered resource' })
  @ApiResponse({ status: 204, description: 'Row deleted.' })
  @ApiResponse({
    status: 404,
    description: 'Unknown resource key or row not found.',
    type: ProblemDetailsDto,
  })
  async deleteResourceRow(
    @CurrentUser() actor: UserPayload,
    @Param('resource', { schema: resourceParamSchema }) resource: string,
    @Param('id', { schema: rowIdParamSchema }) id: string,
  ) {
    const removed = await this.data.remove(actor.sub, this.resolve(resource), id);
    if (!removed) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Row not found',
      });
    }
  }

  private resolve(key: string): AdminResource {
    const resource = getAdminResource(key);
    if (resource === undefined) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: `Unknown resource: ${key}`,
      });
    }
    return resource;
  }
}

registerResponseSchema({
  path: '/api/v1/admin/data/{resource}',
  method: 'get',
  componentName: 'AdminResourceListResponse',
  schema: adminResourceListResponseSchema,
  description: 'Paginated resource rows.',
});
registerResponseSchema({
  path: '/api/v1/admin/data/{resource}/{id}',
  method: 'get',
  componentName: 'AdminResourceRow',
  schema: adminResourceRowSchema,
  description: 'Resource row.',
});
registerResponseSchema({
  path: '/api/v1/admin/data/{resource}',
  method: 'post',
  componentName: 'AdminResourceRow',
  schema: adminResourceRowSchema,
  description: 'Created resource row.',
});
registerResponseSchema({
  path: '/api/v1/admin/data/{resource}/{id}',
  method: 'put',
  componentName: 'AdminResourceRow',
  schema: adminResourceRowSchema,
  description: 'Updated resource row.',
});
