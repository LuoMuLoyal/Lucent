import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';

import { ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { SecurityElevationGuard } from '../security-pin';
import { RequireSecurityElevation } from '../security-pin';
import { DataExportService } from './services/export.service';
import {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
  DataExportRequestResponseDto,
} from './dto/export-response.dto';

@ApiTags('Data Export')
@ApiBearerAuth('access-token')
@ApiExtraModels(DataExportRequestDataDto)
@UseGuards(SecurityElevationGuard)
@Controller('data-export-requests')
export class DataExportController {
  constructor(private readonly exportService: DataExportService) {}

  @Post()
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new data export request' })
  @ApiResponse({ status: 201, type: DataExportRequestResponseDto })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsDto,
    description: 'Duplicate data export request (unique constraint race).',
  })
  @ApiResponse({
    status: 503,
    type: ProblemDetailsDto,
    description: 'Object storage backend is not reachable.',
  })
  async createRequest(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDataExportRequestDto,
    @I18nLang() language: string,
  ) {
    return await unwrapResult(
      this.exportService.createRequest(user.sub, dto, language),
    );
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest data export request' })
  @ApiResponse({
    status: 200,
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(DataExportRequestDataDto) }],
    },
  })
  @ApiResponse({
    status: 503,
    type: ProblemDetailsDto,
    description: 'Object storage backend is not reachable.',
  })
  async getLatestRequest(@CurrentUser() user: UserPayload) {
    return await unwrapResult(this.exportService.getLatestRequest(user.sub));
  }
}
