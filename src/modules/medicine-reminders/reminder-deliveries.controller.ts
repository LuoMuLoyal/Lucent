import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common/api-envelope';
import type { UserPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReminderDeliveryListResponseDto } from './dto';
import { MedicineRemindersService } from './medicine-reminders.service';

@ApiTags('Reminder Deliveries')
@Controller('reminder-deliveries')
export class ReminderDeliveriesController {
  constructor(private readonly service: MedicineRemindersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List reminder delivery audit logs' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-06-10',
    description: 'Optional scheduled date filter in YYYY-MM-DD format.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Maximum rows to return. Clamped to 1-100.',
  })
  @ApiResponse({ status: 200, type: ReminderDeliveryListResponseDto })
  async list(
    @CurrentUser() user: UserPayload,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    return successEnvelope(
      await this.service.listDeliveries(user.sub, date, this.parseLimit(limit)),
    );
  }

  private parseLimit(value: string | undefined): number {
    if (value == null || value.trim().length === 0) return 20;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 20;
  }
}
