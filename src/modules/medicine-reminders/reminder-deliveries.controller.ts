import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UserPayload } from '../auth/index.js';
import { CurrentUser } from '../auth/index.js';
import { ProblemDetailsDto } from '../../common/index.js';
import { unwrapResult } from '../../common/result/index.js';
import { registerResponseSchema } from '../../common/api/response-schema.registry.js';
import { localCapabilityStateSchema } from './dto/local-capability.dto.js';
import type { LocalCapabilityStateDto } from './dto/local-capability.dto.js';
import { reminderDeliveryReceiptSchema } from './dto/reminder-delivery-receipt.dto.js';
import type { ReminderDeliveryReceiptDto } from './dto/reminder-delivery-receipt.dto.js';
import {
  localCapabilityResponseSchema,
  reminderDeliveryListResponseSchema,
  reminderDeliveryReceiptResponseSchema,
} from './dto/reminder-delivery-response.dto.js';
import { DeliveryReceiptsService } from './services/delivery-receipts.service.js';
import { MedicineRemindersService } from './services/reminders.service.js';

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
  @ApiResponse({ status: 200, description: 'Reminder delivery audit rows.' })
  @SerializeOptions({ schema: reminderDeliveryListResponseSchema })
  @ApiResponse({
    status: 400,
    description: 'Invalid date filter (VALIDATION_FAILED)',
    type: ProblemDetailsDto,
  })
  async list(
    @CurrentUser() user: UserPayload,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
  ) {
    return await unwrapResult(
      this.service.listDeliveries(user.sub, date, this.parseLimit(limit)),
    );
  }

  @Post('receipts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Record a local notification delivery receipt (idempotent)',
  })
  @ApiResponse({ status: 201, description: 'The recorded delivery row.' })
  @SerializeOptions({ schema: reminderDeliveryReceiptResponseSchema })
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
  async recordReceipt(
    @CurrentUser() user: UserPayload,
    @Body({ schema: reminderDeliveryReceiptSchema })
    dto: ReminderDeliveryReceiptDto,
  ) {
    return {
      item: await unwrapResult(
        this.receiptsService.recordLocalReceipt(user.sub, dto),
      ),
    };
  }

  @Put('local-capability')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Report client local scheduling capability' })
  @ApiResponse({
    status: 200,
    description: 'The persisted local scheduling capability state.',
  })
  @SerializeOptions({ schema: localCapabilityResponseSchema })
  async reportLocalCapability(
    @CurrentUser() user: UserPayload,
    @Body({ schema: localCapabilityStateSchema })
    dto: LocalCapabilityStateDto,
  ) {
    return await unwrapResult(
      this.receiptsService.reportLocalCapability(user.sub, dto.state),
    );
  }

  private parseLimit(value: string | undefined): number {
    if (value == null || value.trim().length === 0) return 20;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 20;
  }
}

registerResponseSchema({
  path: '/api/v1/user/reminder-deliveries',
  method: 'get',
  componentName: 'ReminderDeliveryListResponseDto',
  schema: reminderDeliveryListResponseSchema,
  description: 'Reminder delivery audit rows.',
});

registerResponseSchema({
  path: '/api/v1/user/reminder-deliveries/receipts',
  method: 'post',
  componentName: 'ReminderDeliveryReceiptResponseDto',
  schema: reminderDeliveryReceiptResponseSchema,
  description: 'The recorded delivery row.',
});

registerResponseSchema({
  path: '/api/v1/user/reminder-deliveries/local-capability',
  method: 'put',
  componentName: 'LocalCapabilityResponseDto',
  schema: localCapabilityResponseSchema,
  description: 'The persisted local scheduling capability state.',
});
