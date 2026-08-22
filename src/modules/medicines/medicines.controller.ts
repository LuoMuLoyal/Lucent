import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { badRequest } from '../../common';
import { CurrentUser } from '../auth';

import { Public } from '../auth';
import type { UserPayload } from '../auth';
import {
  CnMedicineDetailDto,
  DrugbankMedicineDetailDto,
} from './dto/detail.dto';

import {
  MedicineDetailQueryDto,
  MedicineSearchQueryDto,
} from './dto/query.dto';

import {
  MedicineDetailResponseDto,
  MedicineSearchResponseDto,
} from './dto/response.dto';

import { MedicineSafetyTipResponseDto } from './dto/safety-tip-response.dto';

import { RecognizeMedicineDto } from './dto/recognize-medicine.dto';
import { RunRiskCheckDto } from './dto/risk/risk-check-request.dto';
import {
  MedicineRiskCheckRecordDto,
  MedicineRiskCheckRecordsDto,
  MedicineRiskCheckRecordResponseDto,
  MedicineRiskCheckRecordsResponseDto,
} from './dto/risk/risk-check-response.dto';
import { MEDICINES_BYPASS_CACHE_HEADER } from './cache/store.constants';
import { MedicinesService } from './services/medicines.service';

import { MedicineRecognitionQueueService } from './services/recognition-queue.service';
import { MedicineRiskCheckService } from './services/risk/risk-check.service';

@ApiTags('Medicines')
@ApiExtraModels(
  DrugbankMedicineDetailDto,
  CnMedicineDetailDto,
  MedicineRiskCheckRecordDto,
  MedicineRiskCheckRecordsDto,
  MedicineRiskCheckRecordResponseDto,
  MedicineRiskCheckRecordsResponseDto,
  MedicineSafetyTipResponseDto,
)
@ApiBearerAuth('access-token')
@Controller('medicines')
export class MedicinesController {
  constructor(
    private readonly medicinesService: MedicinesService,
    private readonly recognitionQueueService: MedicineRecognitionQueueService,
    private readonly riskCheckService: MedicineRiskCheckService,
  ) {}

  // TODO(archive): 接口完整但当前无任何 C 端 UI 消费方（死代码保留）；
  // 若未来做随机安全贴士，应在移动端药品详情页内以审核内容卡片形式重做。
  @Public()
  @Get('safety-tips')
  @ApiOperation({ summary: 'Get random medication safety tips' })
  @ApiQuery({
    name: 'exclude',
    required: false,
    isArray: true,
    type: String,
    description:
      'Safety tip IDs from the last response, used for deduplication',
  })
  @ApiResponse({ status: 200, type: [MedicineSafetyTipResponseDto] })
  async getSafetyTips(
    @Query('exclude') exclude?: string | string[],
    @I18nLang() lang?: string,
  ) {
    const normalizedExclude = Array.isArray(exclude)
      ? exclude
      : exclude
        ? [exclude]
        : [];
    const tips = await this.medicinesService.getRandomSafetyTips(
      normalizedExclude,
      lang,
    );
    return tips;
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Search medicines from a selected knowledge source',
  })
  @ApiHeader({
    name: MEDICINES_BYPASS_CACHE_HEADER,
    required: false,
    description:
      'Set to true/1/no-cache to bypass medicines read cache for this request only.',
  })
  @ApiResponse({ status: 200, type: MedicineSearchResponseDto })
  async search(
    @Query() query: MedicineSearchQueryDto,
    @Headers(MEDICINES_BYPASS_CACHE_HEADER) bypassCacheHeader?: string,
  ) {
    const result = await this.medicinesService.searchWithCache(
      query,
      this.shouldBypassCache(bypassCacheHeader),
    );

    return {
      items: result.items,
      pagination: result.pagination,
    };
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Get medicine detail from a selected knowledge source',
  })
  @ApiHeader({
    name: MEDICINES_BYPASS_CACHE_HEADER,
    required: false,
    description:
      'Set to true/1/no-cache to bypass medicines read cache for this request only.',
  })
  @ApiParam({ name: 'id', description: 'Medicine id in the selected source' })
  @ApiResponse({ status: 200, type: MedicineDetailResponseDto })
  async getDetail(
    @Param('id') id: string,
    @Query() query: MedicineDetailQueryDto,
    @Headers(MEDICINES_BYPASS_CACHE_HEADER) bypassCacheHeader?: string,
  ) {
    const result = await this.medicinesService.getDetailWithCache(
      id,
      query,
      this.shouldBypassCache(bypassCacheHeader),
    );
    return result;
  }

  private shouldBypassCache(value: string | undefined): boolean {
    if (!value) {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'no-cache'
    );
  }

  // ── Medicine Risk Check ──────────────────────────────────────────

  @Get('risk-check')
  @ApiOperation({ summary: 'Get latest medicine risk check records' })
  @ApiResponse({ status: 200, type: MedicineRiskCheckRecordsResponseDto })
  async getRiskCheck(@CurrentUser() user: UserPayload) {
    const records = await this.riskCheckService.getRecords(user.sub);
    return records;
  }

  @Post('risk-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run medicine risk check (static or LLM)' })
  @ApiResponse({ status: 200, type: MedicineRiskCheckRecordResponseDto })
  async runRiskCheck(
    @CurrentUser() user: UserPayload,
    @Body() dto: RunRiskCheckDto,
  ) {
    if (dto.candidate != null && dto.type === 'llm') {
      badRequest('候选预检仅支持 static 检查');
    }

    const record =
      dto.type === 'llm'
        ? await this.riskCheckService.runLlmCheck(user.sub)
        : await this.riskCheckService.runStaticCheck(user.sub, dto.candidate);
    return record;
  }

  // ── AI Medicine Box Recognition ──────────────────────────────────

  @Post('recognize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'AI recognize medicine box image and extract medicine info',
  })
  async recognize(
    @CurrentUser() _user: UserPayload,
    @Body() dto: RecognizeMedicineDto,
  ) {
    return await this.medicinesService.recognizeMedicine(dto.imageUrl);
  }

  @Post('recognize/async')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue async medicine box image recognition' })
  @ApiResponse({
    status: 200,
    description: 'Job enqueued. Returns jobId for polling.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'number', example: 0 },
        data: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
        },
      },
    },
  })
  async recognizeAsync(
    @CurrentUser() user: UserPayload,
    @Body() dto: RecognizeMedicineDto,
  ) {
    if (this.recognitionQueueService.isConfigured) {
      const jobId = await this.recognitionQueueService.enqueue(
        user.sub,
        dto.imageUrl,
      );
      if (jobId != null) {
        return { jobId };
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await this.medicinesService.recognizeMedicine(dto.imageUrl);
    return { result };
  }

  @SkipThrottle()
  @Get('recognize/status/:jobId')
  @ApiOperation({ summary: 'Poll async medicine recognition status' })
  @ApiResponse({
    status: 200,
    description: 'Job status (pending, completed, or failed)',
  })
  async recognizeStatus(
    @CurrentUser() user: UserPayload,
    @Param('jobId') jobId: string,
  ) {
    const status = await this.recognitionQueueService.getStatus(
      jobId,
      user.sub,
    );
    if (status == null) {
      return { status: 'not_found' };
    }
    return status;
  }
}
