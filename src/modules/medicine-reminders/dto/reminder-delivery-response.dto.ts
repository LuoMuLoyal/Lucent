import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ReminderDeliveryItemDto {
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

export class ReminderDeliveryListResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => ReminderDeliveryListDataDto })
  data!: ReminderDeliveryListDataDto;
}
