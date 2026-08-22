import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { LocalCapabilityState } from '../constants/delivery.constants';

export class ReminderDeliveryItemDto {
  @ApiProperty({ description: 'Delivery log id.' })
  id!: string;

  @ApiPropertyOptional({ description: 'Linked medicine reminder id.' })
  reminderId!: string | null;

  @ApiPropertyOptional({ description: 'Target device id.' })
  deviceId!: string | null;

  @ApiProperty({
    description: 'Delivery channel.',
    example: 'local',
  })
  channel!: string;

  @ApiProperty({
    description: 'Delivery status.',
    example: 'scheduled',
  })
  status!: string;

  @ApiProperty({ description: 'Scheduled delivery time (ISO 8601).' })
  scheduledFor!: string;

  @ApiPropertyOptional({ description: 'Actual delivery time (ISO 8601).' })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ description: 'Failure reason, if any.' })
  errorMessage!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;
}

class ReminderDeliveryListDataDto {
  @ApiProperty({ type: () => ReminderDeliveryItemDto, isArray: true })
  items!: ReminderDeliveryItemDto[];
}

export class ReminderDeliveryListResponseDto extends ReminderDeliveryListDataDto {}

class ReminderDeliveryReceiptDataDto {
  @ApiProperty({ type: () => ReminderDeliveryItemDto })
  item!: ReminderDeliveryItemDto;
}

/** 本地通知回执响应信封：`{ code, message, data: { item } }`。 */
export class ReminderDeliveryReceiptResponseDto extends ReminderDeliveryReceiptDataDto {}

class LocalCapabilityDataDto {
  @ApiProperty({
    description: 'Persisted local scheduling capability state.',
    enum: ['active', 'unavailable', 'disabled'],
    example: 'active',
  })
  state!: LocalCapabilityState;
}

/** 本地调度能力上报响应信封：`{ code, message, data: { state } }`。 */
export class LocalCapabilityResponseDto extends LocalCapabilityDataDto {}
