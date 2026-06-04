import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DailyRecordKind } from '../../generated/prisma/client';

class DailyRecordItemDto {
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

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;

  @ApiProperty({ description: 'Updated at (ISO 8601).' })
  updatedAt!: string;
}

class DailyRecordSummaryDto {
  @ApiProperty({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  kind!: DailyRecordKind;

  @ApiProperty({
    description: 'Count of records for this kind on the given date.',
  })
  count!: number;

  @ApiPropertyOptional({
    type: () => DailyRecordItemDto,
    description: 'Most recent record of this kind.',
  })
  latest?: DailyRecordItemDto | null;
}

class DailyRecordListDataDto {
  @ApiProperty({ type: () => DailyRecordItemDto, isArray: true })
  items!: DailyRecordItemDto[];

  @ApiProperty({
    description: 'Total records for the date (before pagination).',
  })
  total!: number;
}

class DailyRecordSummaryDataDto {
  @ApiProperty({ type: () => DailyRecordSummaryDto, isArray: true })
  summaries!: DailyRecordSummaryDto[];
}

export class DailyRecordListResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordListDataDto })
  data!: DailyRecordListDataDto;
}

export class DailyRecordSummaryResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordSummaryDataDto })
  data!: DailyRecordSummaryDataDto;
}

export class DailyRecordResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => DailyRecordItemDto })
  data!: DailyRecordItemDto;
}
