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
  SerializeOptions,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { CurrentUser } from '../auth/index.js';

import { Public } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';

import {
  medicineDetailQuerySchema,
  medicineSearchQuerySchema,
} from './dto/query.dto.js';
import type {
  MedicineDetailQueryDto,
  MedicineSearchQueryDto,
} from './dto/query.dto.js';

import {
  medicineDetailResponseSchema,
  medicineSearchResponseSchema,
} from './dto/response.dto.js';

import {
  medicineSafetyTipResponseSchema,
  medicineSafetyTipsResponseSchema,
} from './dto/safety-tip-response.dto.js';

import { recognizeMedicineSchema } from './dto/recognize-medicine.dto.js';
import type { RecognizeMedicineDto } from './dto/recognize-medicine.dto.js';
import { medicineRecognitionAsyncResponseSchema } from './dto/recognition-response.dto.js';
import { runRiskCheckSchema } from './dto/risk/risk-check-request.dto.js';
import type { RunRiskCheckDto } from './dto/risk/risk-check-request.dto.js';
import {
  medicineRiskCheckRecordResponseSchema,
  medicineRiskCheckRecordsResponseSchema,
} from './dto/risk/risk-check-response.dto.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { MEDICINES_BYPASS_CACHE_HEADER } from './cache/store.constants.js';
import { MedicinesService } from './services/medicines.service.js';

import { MedicineRecognitionQueueService } from './services/recognition-queue.service.js';
import { MedicineRiskCheckService } from './services/risk/risk-check.service.js';
import {
  createDomainFailure,
  DomainFailureException,
  unwrapResult,
} from '../../common/result/index.js';

@ApiTags('Medicines')
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
  @ApiResponse({ status: 200, description: 'Random medication safety tips.' })
  @SerializeOptions({ schema: medicineSafetyTipResponseSchema })
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
  @ApiResponse({
    status: 200,
    description: 'Search results from the selected knowledge source.',
  })
  @SerializeOptions({ schema: medicineSearchResponseSchema })
  async search(
    @Query({ schema: medicineSearchQuerySchema }) query: MedicineSearchQueryDto,
    @Headers(MEDICINES_BYPASS_CACHE_HEADER) bypassCacheHeader?: string,
  ) {
    const result = await unwrapResult(
      this.medicinesService.searchWithCache(
        query,
        this.shouldBypassCache(bypassCacheHeader),
      ),
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
  @ApiResponse({
    status: 200,
    description: 'Medicine detail from the selected knowledge source.',
  })
  @SerializeOptions({ schema: medicineDetailResponseSchema })
  async getDetail(
    @Param('id') id: string,
    @Query({ schema: medicineDetailQuerySchema })
    query: MedicineDetailQueryDto,
    @Headers(MEDICINES_BYPASS_CACHE_HEADER) bypassCacheHeader?: string,
  ) {
    const result = await unwrapResult(
      this.medicinesService.getDetailWithCache(
        id,
        query,
        this.shouldBypassCache(bypassCacheHeader),
      ),
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
  @ApiResponse({
    status: 200,
    description: 'Latest static and LLM medicine risk check records.',
  })
  @SerializeOptions({ schema: medicineRiskCheckRecordsResponseSchema })
  async getRiskCheck(@CurrentUser() user: UserPayload) {
    const records = await this.riskCheckService.getRecords(user.sub);
    return records;
  }

  @Post('risk-check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run medicine risk check (static or LLM)' })
  @ApiResponse({
    status: 200,
    description: 'The created medicine risk check record.',
  })
  @SerializeOptions({ schema: medicineRiskCheckRecordResponseSchema })
  async runRiskCheck(
    @CurrentUser() user: UserPayload,
    @Body({ schema: runRiskCheckSchema }) dto: RunRiskCheckDto,
  ) {
    if (dto.candidate != null && dto.type === 'llm') {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          detail: '候选预检仅支持 static 检查',
        }),
      );
    }

    const record = await unwrapResult(
      dto.type === 'llm'
        ? this.riskCheckService.runLlmCheck(user.sub)
        : this.riskCheckService.runStaticCheck(user.sub, dto.candidate),
    );
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
    @Body({ schema: recognizeMedicineSchema }) dto: RecognizeMedicineDto,
  ) {
    return await this.medicinesService.recognizeMedicine(dto.imageUrl);
  }

  @Post('recognize/async')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue async medicine box image recognition' })
  @ApiResponse({
    status: 200,
    description:
      'Returns either a queued jobId or the synchronous recognition resource when the queue is unavailable.',
  })
  @SerializeOptions({ schema: medicineRecognitionAsyncResponseSchema })
  async recognizeAsync(
    @CurrentUser() user: UserPayload,
    @Body({ schema: recognizeMedicineSchema }) dto: RecognizeMedicineDto,
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

registerResponseSchema({
  path: '/api/v1/medicines/safety-tips',
  method: 'get',
  componentName: 'MedicineSafetyTipResponse',
  schema: medicineSafetyTipsResponseSchema,
  description: 'Random medication safety tips.',
});

registerResponseSchema({
  path: '/api/v1/medicines',
  method: 'get',
  componentName: 'MedicineSearchResponse',
  schema: medicineSearchResponseSchema,
  description: 'Search results from the selected knowledge source.',
});

registerResponseSchema({
  path: '/api/v1/medicines/{id}',
  method: 'get',
  componentName: 'MedicineDetailResponse',
  schema: medicineDetailResponseSchema,
  description: 'Medicine detail from the selected knowledge source.',
});

registerResponseSchema({
  path: '/api/v1/medicines/risk-check',
  method: 'get',
  componentName: 'MedicineRiskCheckRecordsResponse',
  schema: medicineRiskCheckRecordsResponseSchema,
  description: 'Latest static and LLM medicine risk check records.',
});

registerResponseSchema({
  path: '/api/v1/medicines/risk-check',
  method: 'post',
  componentName: 'MedicineRiskCheckRecordResponse',
  schema: medicineRiskCheckRecordResponseSchema,
  description: 'The created medicine risk check record.',
});

registerResponseSchema({
  path: '/api/v1/medicines/recognize/async',
  method: 'post',
  componentName: 'MedicineRecognitionJob',
  schema: medicineRecognitionAsyncResponseSchema,
  description:
    'Returns either a queued jobId or the synchronous recognition resource when the queue is unavailable.',
});
