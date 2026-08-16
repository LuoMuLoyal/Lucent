import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { successEnvelope } from '../../common';
import type { UserPayload } from '../auth';
import { CurrentUser } from '../auth';
import { LocalCapabilityStateDto } from './dto/local-capability.dto';
import { ReminderDeliveryReceiptDto } from './dto/reminder-delivery-receipt.dto';
import {
  LocalCapabilityResponseDto,
  ReminderDeliveryListResponseDto,
  ReminderDeliveryReceiptResponseDto,
} from './dto/reminder-delivery-response.dto';
import { DeliveryReceiptsService } from './services/delivery-receipts.service';
import { MedicineRemindersService } from './services/reminders.service';

@ApiTags('Reminder Deliveries')
@Controller('reminder-deliveries')
export class ReminderDeliveriesController {
  constructor(
    private readonly service: MedicineRemindersService,
    private readonly receiptsService: DeliveryReceiptsService,
  ) {}

  @Get()
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

  @Post('receipts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Record a local notification delivery receipt (idempotent)',
  })
  @ApiBody({ type: ReminderDeliveryReceiptDto })
  @ApiResponse({ status: 201, type: ReminderDeliveryReceiptResponseDto })
  async recordReceipt(
    @CurrentUser() user: UserPayload,
    @Body() dto: ReminderDeliveryReceiptDto,
  ) {
    return successEnvelope({
      item: await this.receiptsService.recordLocalReceipt(user.sub, dto),
    });
  }

  @Put('local-capability')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Report client local scheduling capability' })
  @ApiBody({ type: LocalCapabilityStateDto })
  @ApiResponse({ status: 200, type: LocalCapabilityResponseDto })
  async reportLocalCapability(
    @CurrentUser() user: UserPayload,
    @Body() dto: LocalCapabilityStateDto,
  ) {
    return successEnvelope(
      await this.receiptsService.reportLocalCapability(user.sub, dto.state),
    );
  }

  private parseLimit(value: string | undefined): number {
    if (value == null || value.trim().length === 0) return 20;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 20;
  }
}
