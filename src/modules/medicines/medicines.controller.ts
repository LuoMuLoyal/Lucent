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
import { Public } from '../auth/decorators/public.decorator';
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
import { ResultCode, successEnvelope } from '../../common/api';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserPayload } from '../auth/services/auth.service';
import { RecognizeMedicineDto } from './dto/recognize-medicine.dto';
import {
  CnMedicineDetailDto,
  DrugbankMedicineDetailDto,
  MedicineDetailQueryDto,
  MedicineDetailResponseDto,
  MedicineSafetyTipResponseDto,
  MedicineSearchQueryDto,
  MedicineSearchResponseDto,
} from './dto';
import { MEDICINES_BYPASS_CACHE_HEADER } from './cache/cache.constants';
import { MedicinesService } from './services/medicines.service';
import { MedicineRecognitionQueueService } from './services/medicine-recognition-queue.service';

@ApiTags('Medicines')
@ApiExtraModels(DrugbankMedicineDetailDto, CnMedicineDetailDto)
@Controller('medicines')
export class MedicinesController {
  constructor(
    private readonly medicinesService: MedicinesService,
    private readonly recognitionQueueService: MedicineRecognitionQueueService,
  ) {}

  @Public()
  @Get('safety-tips')
  @ApiOperation({ summary: '随机返回用药安全提示' })
  @ApiQuery({
    name: 'exclude',
    required: false,
    isArray: true,
    type: String,
    description: '上一次返回的提示 id 列表，用于相邻两次去重',
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
    return successEnvelope(tips);
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
      code: ResultCode.SUCCESS,
      message: '',
      data: result.items,
      meta: {
        pagination: result.pagination,
      },
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
    return successEnvelope(result);
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

  // ── AI Medicine Box Recognition ──────────────────────────────────

  @Post('recognize')
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI识别药盒图片，提取药品信息' })
  async recognize(
    @CurrentUser() _user: UserPayload,
    @Body() dto: RecognizeMedicineDto,
  ) {
    return successEnvelope(
      await this.medicinesService.recognizeMedicine(dto.imageUrl),
    );
  }

  @Post('recognize/async')
  @ApiBearerAuth('access-token')
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
        return successEnvelope({ jobId });
      }
    }

    // Fallback: run synchronously when Redis is not available
    const result = await this.medicinesService.recognizeMedicine(dto.imageUrl);
    return successEnvelope({ result });
  }

  @SkipThrottle()
  @Get('recognize/status/:jobId')
  @ApiBearerAuth('access-token')
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
      return successEnvelope({ status: 'not_found' });
    }
    return successEnvelope(status);
  }
}
