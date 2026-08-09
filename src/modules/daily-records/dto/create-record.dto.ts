import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordAttachmentInputDto } from './record-attachment.dto';

export class CreateDailyRecordDto {
  @ApiProperty({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  @IsEnum(DailyRecordKind)
  kind!: DailyRecordKind;

  @ApiProperty({
    description:
      'Date in YYYY-MM-DD format. For sleep records this is the wake date (the morning the user wakes up from that sleep).',
    example: '2026-06-04',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiPropertyOptional({
    description:
      'Time in HH:mm 24-hour format. When omitted, UI flows may treat the record as date-only.',
    example: '09:45',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  occurredTime?: string;

  @ApiPropertyOptional({ description: 'Short label.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Measured value.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  value?: string;

  @ApiPropertyOptional({ description: 'Unit label.', example: 'bpm' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit?: string;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Record source. Defaults to "manual". Use "apple_health" or "health_connect" for auto-synced records.',
    example: 'manual',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  source?: string;

  @ApiPropertyOptional({
    description: 'Optional active health event association.',
    format: 'uuid',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUUID()
  healthEventId?: string | null;

  @ApiPropertyOptional({
    description:
      'Structured payload for kind-specific data. For sleep: { startAt, endAt, durationMinutes, quality?, deepMinutes?, lightMinutes?, remMinutes? }. endAt is an ISO 8601 timestamp whose date component matches occurredAt (wake date). startAt is the bedtime ISO 8601 timestamp and may fall on the day before occurredAt for cross-midnight sleep. For vital: { vitalType: "heartRate"|"bloodPressure"|"bloodOxygen"|"bloodGlucose"|"bodyTemperature"|"weight"|"respiratoryRate", value: number, unit: string, secondaryValue?: number, secondaryUnit?: string }. For activity: { activityType: "steps"|"flightsClimbed"|"distance"|"exerciseTime", value: number, unit: string }. Vital and activity payloads are optional for manual entry.',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: () => DailyRecordAttachmentInputDto,
    isArray: true,
    description:
      'Attachment metadata. File upload itself is handled separately.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyRecordAttachmentInputDto)
  attachments?: DailyRecordAttachmentInputDto[];
}
