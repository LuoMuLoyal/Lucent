import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiExtraModels,
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
  @ApiResponse({ status: 200, type: MedicineSearchResponseDto })
  async search(@Query() query: MedicineSearchQueryDto) {
    const result = await this.medicinesService.search(query);

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
  @ApiParam({ name: 'id', description: 'Medicine id in the selected source' })
  @ApiResponse({ status: 200, type: MedicineDetailResponseDto })
  async getDetail(
    @Param('id') id: string,
    @Query() query: MedicineDetailQueryDto,
  ) {
    const result = await this.medicinesService.getDetail(id, query);
    return successEnvelope(result);
  }
}
