import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common/api';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { UserPayload } from '../auth/services/auth.service';
import {
  CreateDoseLogDto,
  DoseLogListResponseDto,
  MarkDoseLogDto,
  DoseLogResponseDto,
  UpdateDoseLogDto,
} from './dto';
import { MedicineDoseLogsService } from './services/medicine-dose-logs.service';

@ApiTags('Medicine Dose Logs')
@Controller('medicine-dose-logs')
export class MedicineDoseLogsController {
  constructor(private readonly service: MedicineDoseLogsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List dose logs for a date' })
  @ApiQuery({ name: 'date', required: true, example: '2026-06-04' })
  @ApiResponse({ status: 200, type: DoseLogListResponseDto })
  async list(@CurrentUser() user: UserPayload, @Query('date') date: string) {
    return successEnvelope(await this.service.list(user.sub, date));
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a dose log' })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDoseLogDto,
  ) {
    return successEnvelope(await this.service.create(user.sub, dto));
  }

  @Post('mark')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Mark a dose log idempotently for one reminder slot',
  })
  @ApiResponse({ status: 201, type: DoseLogResponseDto })
  async mark(@CurrentUser() user: UserPayload, @Body() dto: MarkDoseLogDto) {
    return successEnvelope(await this.service.mark(user.sub, dto));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: DoseLogResponseDto })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDoseLogDto,
  ) {
    return successEnvelope(await this.service.update(user.sub, id, dto));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Soft-delete a dose log' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200 })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.service.delete(user.sub, id);
    return successEnvelope(null);
  }
}
