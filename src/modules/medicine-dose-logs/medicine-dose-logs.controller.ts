import {
  Body,
  Controller,
  Delete,
  Get,
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
import { successEnvelope } from '../../common';
import { clampPage, clampPageSize } from '../../common';
import { CurrentUser } from '../auth';
import type { UserPayload } from '../auth';
import { CreateDoseLogDto } from './dto/create-dose-log.dto';

import {
  DoseLogListResponseDto,
  DoseLogResponseDto,
} from './dto/dose-log-response.dto';

import { MarkDoseLogDto } from './dto/mark-dose-log.dto';

import { UpdateDoseLogDto } from './dto/update-dose-log.dto';
import { MedicineDoseLogsService } from './services/dose-logs.service';

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
    return successEnvelope(
      await this.doseLogsService.list(
        user.sub,
        date,
        clampPage(page),
        clampPageSize(pageSize),
      ),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a dose log' })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDoseLogDto,
  ) {
    return successEnvelope(await this.doseLogsService.create(user.sub, dto));
  }

  @Post('mark')
  @ApiOperation({
    summary: 'Mark a dose log idempotently for one reminder slot',
  })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  async mark(@CurrentUser() user: UserPayload, @Body() dto: MarkDoseLogDto) {
    return successEnvelope(await this.doseLogsService.mark(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DoseLogResponseDto })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDoseLogDto,
  ) {
    return successEnvelope(
      await this.doseLogsService.update(user.sub, id, dto),
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200 })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.doseLogsService.delete(user.sub, id);
    return successEnvelope(null);
  }
}
