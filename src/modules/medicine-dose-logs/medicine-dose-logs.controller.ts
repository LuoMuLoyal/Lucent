import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import {
  clampPage,
  clampPageSize,
  ProblemDetailsDto,
} from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { CurrentUser } from '../auth/index.js';
import type { UserPayload } from '../auth/index.js';
import { createDoseLogSchema } from './dto/create-dose-log.dto.js';
import type { CreateDoseLogDto } from './dto/create-dose-log.dto.js';

import {
  DoseLogListResponseDto,
  DoseLogResponseDto,
} from './dto/dose-log-response.dto.js';

import { markDoseLogSchema } from './dto/mark-dose-log.dto.js';
import type { MarkDoseLogDto } from './dto/mark-dose-log.dto.js';

import { updateDoseLogSchema } from './dto/update-dose-log.dto.js';
import type { UpdateDoseLogDto } from './dto/update-dose-log.dto.js';
import { MedicineDoseLogsService } from './services/dose-logs.service.js';

@ApiTags('Medicine Dose Logs')
@ApiBearerAuth('access-token')
@Controller('medicine-dose-logs')
export class MedicineDoseLogsController {
  constructor(private readonly doseLogsService: MedicineDoseLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List dose logs for a date' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 50 })
  @ApiResponse({ status: 200, type: DoseLogListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query('date') date: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true }))
    pageSize: number = 50,
  ) {
    return await this.doseLogsService.list(
      user.sub,
      date,
      clampPage(page),
      clampPageSize(pageSize),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a dose log' })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid slot identity (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Reminder or current medicine not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Duplicate dose log for the same slot (RESOURCE_CONFLICT, race)',
    type: ProblemDetailsDto,
  })
  async create(
    @CurrentUser() user: UserPayload,
    @Body({ schema: createDoseLogSchema }) dto: CreateDoseLogDto,
  ) {
    return await unwrapResult(this.doseLogsService.create(user.sub, dto));
  }

  @Post('mark')
  @ApiOperation({
    summary: 'Mark a dose log idempotently for one reminder slot',
  })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Missing slot identifier or invalid slot identity (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Reminder or current medicine not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'Duplicate dose log for the same slot (RESOURCE_CONFLICT, race)',
    type: ProblemDetailsDto,
  })
  async mark(
    @CurrentUser() user: UserPayload,
    @Body({ schema: markDoseLogSchema }) dto: MarkDoseLogDto,
  ) {
    return await unwrapResult(this.doseLogsService.mark(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DoseLogResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Dose log not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body({ schema: updateDoseLogSchema }) dto: UpdateDoseLogDto,
  ) {
    return await unwrapResult(this.doseLogsService.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 204, description: 'Dose log deleted.' })
  @ApiResponse({
    status: 404,
    description: 'Dose log not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await unwrapResult(this.doseLogsService.delete(user.sub, id));
    return;
  }
}
