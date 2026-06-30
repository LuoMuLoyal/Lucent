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
import { successEnvelope } from '../../common/api-envelope';
import type { UserPayload } from '../auth/services/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateMedicineReminderDto,
  MedicineReminderListResponseDto,
  MedicineReminderResponseDto,
  UpdateMedicineReminderDto,
} from './dto';
import { MedicineRemindersService } from './services/medicine-reminders.service';

@ApiTags('Medicine Reminders')
@Controller('medicine-reminders')
export class MedicineRemindersController {
  constructor(private readonly service: MedicineRemindersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
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
      await this.service.list(user.sub, this.parseBoolean(activeOnly)),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a medicine reminder schedule' })
  @ApiResponse({ status: 201, type: MedicineReminderResponseDto })
  async create(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateMedicineReminderDto,
  ) {
    return successEnvelope(await this.service.create(user.sub, dto));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: MedicineReminderResponseDto })
  async update(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineReminderDto,
  ) {
    return successEnvelope(await this.service.update(user.sub, id, dto));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Soft-delete a medicine reminder schedule' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200 })
  async delete(@CurrentUser() user: UserPayload, @Param('id') id: string) {
    await this.service.delete(user.sub, id);
    return successEnvelope(null);
  }

  private parseBoolean(value: string | undefined): boolean {
    return value === 'true' || value === '1' || value === 'yes';
  }
}
