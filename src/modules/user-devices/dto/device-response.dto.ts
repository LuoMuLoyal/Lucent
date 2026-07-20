import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Single device item returned by the user-devices API.
 */
export class DeviceItemDto {
  @ApiProperty({ description: 'Device record ID.' })
  id!: string;

  @ApiProperty({ description: 'Device platform.', example: 'ios' })
  platform!: string;

  @ApiPropertyOptional({ description: 'Human-readable device name.' })
  deviceName!: string | null;

  @ApiProperty({ description: 'Whether push notifications are enabled.' })
  notificationsEnabled!: boolean;

  @ApiPropertyOptional({ description: 'User locale preference.' })
  locale!: string | null;

  @ApiPropertyOptional({ description: 'User timezone preference.' })
  timezone!: string | null;

  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp of last device activity.',
  })
  lastSeenAt!: string | null;

  @ApiProperty({ description: 'ISO 8601 creation timestamp.' })
  createdAt!: string;

  @ApiProperty({ description: 'ISO 8601 last-update timestamp.' })
  updatedAt!: string;
}

/**
 * Response shape for POST /user-devices (register/update).
 */
export class DeviceResponseDto extends DeviceItemDto {}

/**
 * Response shape for GET /user-devices (list).
 */
export class DeviceListResponseDto {
  @ApiProperty({ type: [DeviceItemDto], description: 'List of registered devices.' })
  items!: DeviceItemDto[];
}
