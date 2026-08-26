import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { DataExportService } from './services/export.service';
import {
  CreateDataExportRequestDto,
  DataExportRequestDataDto,
  DataExportRequestResponseDto,
} from './dto/export-response.dto';

@ApiTags('Data Export')
@ApiBearerAuth('access-token')
@ApiExtraModels(DataExportRequestDataDto)
@Controller('data-export-requests')
export class DataExportController {
  constructor(private readonly exportService: DataExportService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new data export request' })
  @ApiBody({ type: CreateDataExportRequestDto })
  @ApiResponse({ status: 201, type: DataExportRequestResponseDto })
  @ApiResponse({
    status: 401,
    description:
      'Wrong password (AUTH_WRONG_PASSWORD) or no password set (AUTH_PASSWORD_NOT_SET)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsDto,
    description: 'Duplicate data export request (unique constraint race).',
  })
  @ApiResponse({
    status: 429,
    type: ProblemDetailsDto,
    description: 'Too many failed re-authentication attempts.',
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
