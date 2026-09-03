import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { HealthEventStatus } from '#generated/prisma/client.js';

export class EventReviewListQueryDto {
  @ApiPropertyOptional({
    enum: HealthEventStatus,
    enumName: 'HealthEventStatus',
    description: 'Filter events by status. No time range is required.',
  })
  @IsOptional()
  @IsEnum(HealthEventStatus)
  status?: HealthEventStatus;

  @ApiPropertyOptional({
    type: String,
    description:
      'Opaque cursor for pagination: composite of the last item startedAt ' +
      'ISO 8601 value and id joined with "|", as returned by nextCursor. ' +
      'Must not be constructed by the client.',
    example: '2026-08-01T08:00:00.000Z|evt-1',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size (1-100).',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
    type: 'integer',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
