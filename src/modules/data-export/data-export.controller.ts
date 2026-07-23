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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';

import { successEnvelope } from '../../common/api';
import { type UserPayload } from '../auth/services';
import { CurrentUser } from '../auth/decorators';
import { SecurityElevationGuard } from '../security-pin/guards';
import { RequireSecurityElevation } from '../security-pin/decorators';
import { DataExportService } from './services';
import {
  CreateDataExportRequestDto,
  DataExportLatestResponseDto,
  DataExportRequestResponseDto,
} from './dto';

@ApiTags('Data Export')
@ApiBearerAuth('access-token')
@UseGuards(SecurityElevationGuard)
@Controller('data-export-requests')
export class DataExportController {
  constructor(private readonly exportService: DataExportService) {}

  @Post()
  @RequireSecurityElevation()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new data export request' })
  @ApiResponse({ status: 201, type: DataExportRequestResponseDto })
  async createRequest(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDataExportRequestDto,
    @I18nLang() language: string,
  ) {
    return successEnvelope(
      await this.exportService.createRequest(user.sub, dto, language),
    );
  }

  @Get('latest')
  @RequireSecurityElevation()
  @ApiOperation({ summary: 'Get the latest data export request' })
  @ApiResponse({ status: 200, type: DataExportLatestResponseDto })
  async getLatestRequest(@CurrentUser() user: UserPayload) {
    return successEnvelope(await this.exportService.getLatestRequest(user.sub));
  }
}
