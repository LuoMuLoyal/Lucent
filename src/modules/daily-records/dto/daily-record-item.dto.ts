import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordAttachmentDto } from './daily-record-attachment.dto';

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

  @ApiPropertyOptional({ description: 'Short label.' })
  title?: string | null;

  @ApiPropertyOptional({ description: 'Measured value.' })
  value?: string | null;

  @ApiPropertyOptional({ description: 'Unit label.', example: 'bpm' })
  unit?: string | null;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  note?: string | null;

  @ApiPropertyOptional({ description: 'Source.', example: 'manual' })
  source?: string | null;

  @ApiPropertyOptional({
    description:
      'Structured payload for kind-specific data. For sleep: { startAt, endAt, durationMinutes, quality?, deepMinutes?, lightMinutes?, remMinutes? }.',
  })
  payload?: Record<string, unknown> | null;

  @ApiProperty({ type: () => DailyRecordAttachmentDto, isArray: true })
  attachments!: DailyRecordAttachmentDto[];

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}
