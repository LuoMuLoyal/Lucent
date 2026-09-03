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
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { createMedicineReminderSchema } from './dto/create.dto.js';
import type { CreateMedicineReminderDto } from './dto/create.dto.js';

import {
  medicineReminderListResponseSchema,
  medicineReminderResponseSchema,
} from './dto/response.dto.js';

import { updateMedicineReminderSchema } from './dto/update.dto.js';
import type { UpdateMedicineReminderDto } from './dto/update.dto.js';
import { upsertMedicineReminderGroupSchema } from './dto/upsert-group.dto.js';
import type { UpsertMedicineReminderGroupDto } from './dto/upsert-group.dto.js';
import { MedicineRemindersService } from './services/reminders.service.js';

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
  @ApiResponse({ status: 200, description: 'Medicine reminder schedules.' })
  @SerializeOptions({ schema: medicineReminderListResponseSchema })
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
  @ApiResponse({ status: 201, description: 'The created medicine reminder.' })
  @SerializeOptions({ schema: medicineReminderResponseSchema })
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
    @Body({ schema: createMedicineReminderSchema })
    dto: CreateMedicineReminderDto,
  ) {
    return await unwrapResult(this.remindersService.create(user.sub, dto));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: 'The updated medicine reminder.' })
  @SerializeOptions({ schema: medicineReminderResponseSchema })
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
    @Body({ schema: updateMedicineReminderSchema })
    dto: UpdateMedicineReminderDto,
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
  @ApiResponse({ status: 200, description: 'The upserted reminder group.' })
  @SerializeOptions({ schema: medicineReminderListResponseSchema })
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
    @Body({ schema: upsertMedicineReminderGroupSchema })
    dto: UpsertMedicineReminderGroupDto,
  ) {
    return await unwrapResult(this.remindersService.upsertGroup(user.sub, dto));
  }

  private parseBoolean(value: string | undefined): boolean {
    return value === 'true' || value === '1' || value === 'yes';
  }
}

registerResponseSchema({
  path: '/api/v1/user/medicine-reminders',
  method: 'get',
  componentName: 'MedicineReminderListResponseDto',
  schema: medicineReminderListResponseSchema,
  description: 'Medicine reminder schedules.',
});

registerResponseSchema({
  path: '/api/v1/user/medicine-reminders',
  method: 'post',
  componentName: 'MedicineReminderResponseDto',
  schema: medicineReminderResponseSchema,
  description: 'The created medicine reminder.',
});

registerResponseSchema({
  path: '/api/v1/user/medicine-reminders/{id}',
  method: 'patch',
  componentName: 'MedicineReminderResponseDto',
  schema: medicineReminderResponseSchema,
  description: 'The updated medicine reminder.',
});

registerResponseSchema({
  path: '/api/v1/user/medicine-reminders/group',
  method: 'put',
  componentName: 'MedicineReminderListResponseDto',
  schema: medicineReminderListResponseSchema,
  description: 'The upserted reminder group.',
});
