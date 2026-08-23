import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { ProblemDetailsDto } from '../../common';
import { unwrapResult } from '../../common/result';
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
    return await this.remindersService.list(
      user.sub,
      this.parseBoolean(activeOnly),
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a medicine reminder schedule' })
  @ApiResponse({ status: 201, type: MedicineReminderResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid reminder payload (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Current medicine not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateMedicineReminderDto,
  ) {
    return await unwrapResult(this.remindersService.create(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: MedicineReminderResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid reminder payload (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Reminder belongs to another user (FORBIDDEN)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Reminder or current medicine not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineReminderDto,
  ) {
    return await unwrapResult(this.remindersService.update(user.sub, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 204, description: 'Medicine reminder deleted.' })
  @ApiResponse({
    status: 403,
    description: 'Reminder belongs to another user (FORBIDDEN)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Reminder not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await unwrapResult(this.remindersService.delete(user.sub, id));
    return;
  }

  @Put('group')
  @ApiOperation({ summary: 'Upsert a whole medicine reminder group' })
  @ApiResponse({ status: 200, type: MedicineReminderListResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Empty group, duplicate slot ids or invalid payload (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Current medicine or a slot not found (RESOURCE_NOT_FOUND)',
    type: ProblemDetailsDto,
  })
  async upsertGroup(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpsertMedicineReminderGroupDto,
  ) {
    return await unwrapResult(this.remindersService.upsertGroup(user.sub, dto));
  }

  private parseBoolean(value: string | undefined): boolean {
    return value === 'true' || value === '1' || value === 'yes';
  }
}
