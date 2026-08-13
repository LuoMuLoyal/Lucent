import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { HealthEventStatus } from '#generated/prisma/client';

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
      'Opaque cursor for pagination: the startedAt ISO 8601 value of the ' +
      'last item from the previous page.',
    example: '2026-08-01T08:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size (1-100).',
    example: 20,
    default: 20,
    maximum: 100,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
