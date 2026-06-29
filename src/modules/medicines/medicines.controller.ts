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
  UseGuards,
} from '@nestjs/common';
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
import { ResultCode, successEnvelope } from '../../common/api-envelope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { UserPayload } from '../auth/auth.service';
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
import { MEDICINES_BYPASS_CACHE_HEADER } from './cache/medicines-cache.constants';
import { MedicinesService } from './medicines.service';

@ApiTags('Medicines')
@ApiExtraModels(DrugbankMedicineDetailDto, CnMedicineDetailDto)
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicinesService: MedicinesService) {}

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
  @UseGuards(JwtAuthGuard)
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
}
