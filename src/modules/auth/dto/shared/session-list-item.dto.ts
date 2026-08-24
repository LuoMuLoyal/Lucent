import { ApiProperty } from '@nestjs/swagger';

/**
 * Single active session entry returned by `GET /api/v1/auth/sessions`.
 */
export class SessionListItemDto {
  @ApiProperty({ description: 'Session id' })
  id!: string;

  @ApiProperty({ description: 'Device type', type: String, nullable: true })
  deviceType!: string | null;

  @ApiProperty({ description: 'Device name', type: String, nullable: true })
  deviceName!: string | null;

  @ApiProperty({ description: 'Platform', type: String, nullable: true })
  platform!: string | null;

  @ApiProperty({
    description: 'Last used at (ISO-8601)',
    type: String,
    nullable: true,
  })
  lastUsedAt!: string | null;

  @ApiProperty({ description: 'Created at (ISO-8601)' })
  createdAt!: string;

  @ApiProperty({ description: 'Expires at (ISO-8601)' })
  expiresAt!: string;

  @ApiProperty({ description: 'Whether this is the current session' })
  isCurrent!: boolean;
}
