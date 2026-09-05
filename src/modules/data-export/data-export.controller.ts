import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import type { FastifyRequest } from 'fastify';

import {
  extractAuthRequestContext,
  ProblemDetailsDto,
} from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { AuditLogService } from '../audit-log/index.js';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { DataExportService } from './services/export.service.js';
import {
  createDataExportRequestSchema,
  dataExportLatestResponseSchema,
  dataExportRequestDataSchema,
} from './dto/export-response.dto.js';
import type { CreateDataExportRequestDto } from './dto/export-response.dto.js';

@ApiTags('Data Export')
@ApiBearerAuth('access-token')
@Controller('data-export-requests')
export class DataExportController {
  constructor(
    private readonly exportService: DataExportService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new data export request' })
  @ApiResponse({
    status: 201,
    description: 'Data export request created.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Wrong password (AUTH_WRONG_PASSWORD) or no password set (AUTH_PASSWORD_NOT_SET)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsDto,
    description: 'Duplicate data export request (unique constraint race).',
  })
  @ApiResponse({
    status: 429,
    type: ProblemDetailsDto,
    description: 'Too many failed re-authentication attempts.',
  })
  @ApiResponse({
    status: 503,
    type: ProblemDetailsDto,
    description: 'Object storage backend is not reachable.',
  })
  @SerializeOptions({ schema: dataExportRequestDataSchema })
  async createRequest(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createDataExportRequestSchema })
    dto: CreateDataExportRequestDto,
    @Req() request: FastifyRequest,
    @I18nLang() language: string,
  ) {
    const result = await unwrapResult(
      this.exportService.createRequest(user.sub, dto, language),
    );
    this.auditLogService.logFireAndForget({
      ...extractAuthRequestContext(request),
      userId: user.sub,
      action: 'data_export.request',
      resourceType: 'data_export',
      resourceId: result.id,
      metadata: { kind: dto.kind, format: dto.format, range: dto.range },
    });
    return result;
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest data export request' })
  @ApiResponse({
    status: 200,
    description: 'Latest data export request, or null when none exists.',
  })
  @ApiResponse({
    status: 503,
    type: ProblemDetailsDto,
    description: 'Object storage backend is not reachable.',
  })
  @SerializeOptions({ schema: dataExportLatestResponseSchema })
  async getLatestRequest(@CurrentUser() user: UserPayload) {
    return await unwrapResult(this.exportService.getLatestRequest(user.sub));
  }
}

registerResponseSchema({
  path: '/api/v1/user/data-export-requests',
  method: 'post',
  componentName: 'DataExportRequestResponse',
  schema: dataExportRequestDataSchema,
  description: 'Data export request created.',
});

registerResponseSchema({
  path: '/api/v1/user/data-export-requests/latest',
  method: 'get',
  componentName: 'DataExportRequestData',
  schema: dataExportLatestResponseSchema,
  description: 'Latest data export request, or null when none exists.',
});
