import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ResultCode, successEnvelope } from '../common/api-envelope';
import {
  CnMedicineDetailDto,
  DrugbankMedicineDetailDto,
  MedicineDetailQueryDto,
  MedicineDetailResponseDto,
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
}
