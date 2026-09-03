import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { unwrapResult } from '../../common/result/index.js';
import { createDailyRecordSchema } from './dto/create-record.dto.js';
import type { CreateDailyRecordDto } from './dto/create-record.dto.js';

import { updateDailyRecordSchema } from './dto/update-record.dto.js';
import type { UpdateDailyRecordDto } from './dto/update-record.dto.js';

import {
  dailyRecordListResponseSchema,
  dailyRecordResponseSchema,
  dailyRecordSummaryResponseSchema,
} from './dto/record-response.dto.js';

import {
  createDailyRecordImageUploadSchema,
  dailyRecordImageUploadResponseSchema,
} from './dto/candidates/record-image-upload.dto.js';
import type { CreateDailyRecordImageUploadDto } from './dto/candidates/record-image-upload.dto.js';

import { dailyRecordCandidateResponseSchema } from './dto/candidates/record-candidate-response.dto.js';

import { generateDailyRecordCandidatesSchema } from './dto/candidates/generate-record-candidates.dto.js';
import type { GenerateDailyRecordCandidatesDto } from './dto/candidates/generate-record-candidates.dto.js';

import { queryDailyRecordSchema } from './dto/query-record.dto.js';
import type { QueryDailyRecordDto } from './dto/query-record.dto.js';
import { DailyRecordCandidatesService } from './services/candidates/orchestrator.service.js';
import { DailyRecordImageUploadService } from './services/image-upload.service.js';
import { DailyRecordsService } from './services/records.service.js';
import { I18nLang } from 'nestjs-i18n';

@ApiTags('Daily Records')
@ApiBearerAuth('access-token')
@Controller('daily-records')
export class DailyRecordsController {
  constructor(
    private readonly dailyRecordsService: DailyRecordsService,
    private readonly dailyRecordCandidatesService: DailyRecordCandidatesService,
    private readonly imageUploadService: DailyRecordImageUploadService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List daily records for a given date' })
  @ApiResponse({
    status: 200,
    description: 'Daily records for the date.',
  })
  @SerializeOptions({ schema: dailyRecordListResponseSchema })
  async list(
    @CurrentUser() user: UserPayload,
    @Query({ schema: queryDailyRecordSchema })
    query: QueryDailyRecordDto,
  ) {
    const result = await this.dailyRecordsService.list(
      user.sub,
      query.date,
      query.kind,
      query.page ?? 1,
      query.pageSize ?? 50,
    );
    return result;
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get daily record summary (counts by kind)' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiResponse({
    status: 200,
    description: 'Daily record counts grouped by kind for the date.',
  })
  @SerializeOptions({ schema: dailyRecordSummaryResponseSchema })
  async summary(@CurrentUser() user: UserPayload, @Query('date') date: string) {
    const result = await this.dailyRecordsService.summary(user.sub, date);
    return result;
  }

  @Post('attachments/images/presign-upload')
  @ApiOperation({
    summary: 'Create a signed URL for daily record image upload',
  })
  @ApiResponse({
    status: 201,
    description: 'Presigned upload metadata for direct object storage upload.',
  })
  @SerializeOptions({ schema: dailyRecordImageUploadResponseSchema })
  async createImageUpload(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createDailyRecordImageUploadSchema })
    dto: CreateDailyRecordImageUploadDto,
  ) {
    const result = await this.imageUploadService.createPresignedUpload(
      user.sub,
      dto,
    );
    return result;
  }

  @Post('candidate-records/generate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Generate AI candidate daily records from a natural-language note',
  })
  @ApiResponse({
    status: 200,
    description: 'Generated candidate daily records (not saved yet).',
  })
  @SerializeOptions({ schema: dailyRecordCandidateResponseSchema })
  async generateCandidates(
    @CurrentUser() user: UserPayload,
    @Body({ schema: generateDailyRecordCandidatesSchema })
    dto: GenerateDailyRecordCandidatesDto,
    @I18nLang() language: string,
  ) {
    const result = await this.dailyRecordCandidatesService.generate(
      user.sub,
      dto,
      language,
    );
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a daily record by id' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The daily record.' })
  @SerializeOptions({ schema: dailyRecordResponseSchema })
  @ApiResponse({
    status: 403,
    description: 'Daily record is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Daily record not found',
    type: ProblemDetailsDto,
  })
  async get(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    return unwrapResult(this.dailyRecordsService.get(user.sub, id));
  }

  @Post()
  @ApiOperation({ summary: 'Create a daily record' })
  @ApiResponse({ status: 201, description: 'The created daily record.' })
  @SerializeOptions({ schema: dailyRecordResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid record payload, or linked health event is not active',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Linked health event is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Linked health event not found',
    type: ProblemDetailsDto,
  })
  async create(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createDailyRecordSchema })
    dto: CreateDailyRecordDto,
  ) {
    return unwrapResult(this.dailyRecordsService.create(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a daily record' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The updated daily record.' })
  @SerializeOptions({ schema: dailyRecordResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid record payload, or linked health event is not active',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Daily record or linked health event is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Daily record or linked health event not found',
    type: ProblemDetailsDto,
  })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body({ schema: updateDailyRecordSchema })
    dto: UpdateDailyRecordDto,
  ) {
    return unwrapResult(this.dailyRecordsService.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a daily record' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 204, description: 'Daily record deleted.' })
  @ApiResponse({
    status: 403,
    description: 'Daily record is owned by another user',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Daily record not found',
    type: ProblemDetailsDto,
  })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await unwrapResult(this.dailyRecordsService.delete(user.sub, id));
    return;
  }
}

// 201 主成功响应注记:export-openapi 目前只把注册组件的 200 响应回写为
// $ref;以下 201 端点(POST create / POST presign-upload)的响应体同样按稳定
// 组件名登记,导出脚本支持 201 回写后自动生效。
registerResponseSchema({
  path: '/api/v1/daily-records',
  method: 'get',
  componentName: 'DailyRecordListResponseDto',
  schema: dailyRecordListResponseSchema,
  description: 'Daily records for the date.',
});

registerResponseSchema({
  path: '/api/v1/daily-records/summary',
  method: 'get',
  componentName: 'DailyRecordSummaryResponseDto',
  schema: dailyRecordSummaryResponseSchema,
  description: 'Daily record counts grouped by kind for the date.',
});

registerResponseSchema({
  path: '/api/v1/daily-records/attachments/images/presign-upload',
  method: 'post',
  componentName: 'DailyRecordImageUploadResponseDto',
  schema: dailyRecordImageUploadResponseSchema,
  description: 'Presigned upload metadata for direct object storage upload.',
});

registerResponseSchema({
  path: '/api/v1/daily-records/candidate-records/generate',
  method: 'post',
  componentName: 'DailyRecordCandidateResponseDto',
  schema: dailyRecordCandidateResponseSchema,
  description: 'Generated candidate daily records (not saved yet).',
});

registerResponseSchema({
  path: '/api/v1/daily-records/:id',
  method: 'get',
  componentName: 'DailyRecordResponseDto',
  schema: dailyRecordResponseSchema,
  description: 'The daily record.',
});

registerResponseSchema({
  path: '/api/v1/daily-records',
  method: 'post',
  componentName: 'DailyRecordResponseDto',
  schema: dailyRecordResponseSchema,
  description: 'The created daily record.',
});

registerResponseSchema({
  path: '/api/v1/daily-records/:id',
  method: 'patch',
  componentName: 'DailyRecordResponseDto',
  schema: dailyRecordResponseSchema,
  description: 'The updated daily record.',
});
