import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordAttachmentDto } from './record-attachment.dto';

export class DailyRecordItemDto {
  @ApiProperty({ description: 'Record id.' })
  id!: string;

  @ApiProperty({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  kind!: DailyRecordKind;

  @ApiProperty({
    description: 'Date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  occurredAt!: string;

  @ApiPropertyOptional({
    description: 'Time in HH:mm 24-hour format when available.',
    example: '09:45',
    nullable: true,
    type: String,
  })
  occurredTime?: string | null;

  @ApiPropertyOptional({
    description: 'Short label.',
    type: String,
    nullable: true,
  })
  title?: string | null;

  @ApiPropertyOptional({
    description: 'Measured value.',
    type: String,
    nullable: true,
  })
  value?: string | null;

  @ApiPropertyOptional({
    description: 'Unit label.',
    example: 'bpm',
    type: String,
    nullable: true,
  })
  unit?: string | null;

  @ApiPropertyOptional({
    description: 'Free-text note.',
    type: String,
    nullable: true,
  })
  note?: string | null;

  @ApiPropertyOptional({
    description: 'Source.',
    example: 'manual',
    type: String,
    nullable: true,
  })
  source?: string | null;

  @ApiPropertyOptional({
    description:
      'Structured payload for kind-specific data. For sleep: { startAt, endAt, durationMinutes, quality?, deepMinutes?, lightMinutes?, remMinutes? }.',
    type: Object,
    additionalProperties: true,
    nullable: true,
  })
  payload?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Meal analysis status for meal records.',
    nullable: true,
    type: String,
  })
  mealAnalysisStatus?: string | null;

  @ApiPropertyOptional({
    description: 'Meal analysis coverage for meal records.',
    nullable: true,
    type: String,
  })
  mealAnalysisCoverage?: string | null;

  @ApiPropertyOptional({
    description: 'Meal analysis updated timestamp (ISO 8601).',
    nullable: true,
    type: String,
  })
  mealAnalysisUpdatedAt?: string | null;

  @ApiPropertyOptional({
    description: 'Display-safe meal analysis failure reason.',
    nullable: true,
    type: String,
  })
  mealAnalysisFailureReason?: string | null;

  @ApiPropertyOptional({
    description: 'Short meal description for list reads.',
    nullable: true,
    type: String,
  })
  mealShortDescription?: string | null;

  @ApiPropertyOptional({
    description: 'Top recognized foods for list reads.',
    isArray: true,
    type: String,
  })
  mealTopFoods?: string[];

  @ApiProperty({ type: () => DailyRecordAttachmentDto, isArray: true })
  attachments!: DailyRecordAttachmentDto[];

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}
