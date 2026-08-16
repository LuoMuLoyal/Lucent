import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { CreateMedicineReminderDto } from './dto/create.dto';

import {
  MedicineReminderListResponseDto,
  MedicineReminderResponseDto,
} from './dto/response.dto';

import { UpdateMedicineReminderDto } from './dto/update.dto';
import { UpsertMedicineReminderGroupDto } from './dto/upsert-group.dto';
import { MedicineRemindersService } from './services/reminders.service';

@ApiTags('Medicine Reminders')
@ApiBearerAuth('access-token')
@Controller('medicine-reminders')
export class MedicineRemindersController {
  constructor(private readonly remindersService: MedicineRemindersService) {}

  @Get()
  @ApiOperation({ summary: 'List medicine reminder schedules' })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    description: 'Set to true to return active reminders only.',
  })
  @ApiResponse({ status: 200, type: MedicineReminderListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return successEnvelope(
      await this.remindersService.list(user.sub, this.parseBoolean(activeOnly)),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a medicine reminder schedule' })
  @ApiResponse({ status: 201, type: MedicineReminderResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateMedicineReminderDto,
  ) {
    return successEnvelope(await this.remindersService.create(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: MedicineReminderResponseDto })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineReminderDto,
  ) {
    return successEnvelope(
      await this.remindersService.update(user.sub, id, dto),
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200 })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.remindersService.delete(user.sub, id);
    return successEnvelope(null);
  }

  @Put('group')
  @ApiOperation({ summary: 'Upsert a whole medicine reminder group' })
  @ApiResponse({ status: 200, type: MedicineReminderListResponseDto })
  async upsertGroup(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpsertMedicineReminderGroupDto,
  ) {
    return successEnvelope(
      await this.remindersService.upsertGroup(user.sub, dto),
    );
  }

  private parseBoolean(value: string | undefined): boolean {
    return value === 'true' || value === '1' || value === 'yes';
  }
}
