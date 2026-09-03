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
import { unwrapResult } from '../../common/result/index.js';
import { CreateDailyRecordDto } from './dto/create-record.dto.js';

import { UpdateDailyRecordDto } from './dto/update-record.dto.js';

import {
  DailyRecordListResponseDto,
  DailyRecordSummaryResponseDto,
  DailyRecordResponseDto,
} from './dto/record-response.dto.js';

import {
  CreateDailyRecordImageUploadDto,
  DailyRecordImageUploadResponseDto,
} from './dto/candidates/record-image-upload.dto.js';

import { DailyRecordCandidateResponseDto } from './dto/candidates/record-candidate-response.dto.js';

import { GenerateDailyRecordCandidatesDto } from './dto/candidates/generate-record-candidates.dto.js';

import { QueryDailyRecordDto } from './dto/query-record.dto.js';
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
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiResponse({ status: 200, type: DailyRecordListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query() query: QueryDailyRecordDto,
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
  @ApiResponse({ status: 200, type: DailyRecordSummaryResponseDto })
  async summary(@CurrentUser() user: UserPayload, @Query('date') date: string) {
    const result = await this.dailyRecordsService.summary(user.sub, date);
    return result;
  }

  @Post('attachments/images/presign-upload')
  @ApiOperation({
    summary: 'Create a signed URL for daily record image upload',
  })
  @ApiResponse({ status: 201, type: DailyRecordImageUploadResponseDto })
  async createImageUpload(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDailyRecordImageUploadDto,
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
  @ApiResponse({ status: 200, type: DailyRecordCandidateResponseDto })
  async generateCandidates(
    @CurrentUser() user: UserPayload,
    @Body() dto: GenerateDailyRecordCandidatesDto,
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
  @ApiResponse({ status: 200, type: DailyRecordResponseDto })
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
  @ApiResponse({ status: 201, type: DailyRecordResponseDto })
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
    @Body() dto: CreateDailyRecordDto,
  ) {
    return unwrapResult(this.dailyRecordsService.create(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a daily record' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DailyRecordResponseDto })
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
    @Body() dto: UpdateDailyRecordDto,
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
