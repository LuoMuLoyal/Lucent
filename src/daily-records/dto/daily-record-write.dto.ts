import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DailyRecordKind } from '../../generated/prisma/client';

export class CreateDailyRecordDto {
  @ApiProperty({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  @IsEnum(DailyRecordKind)
  kind!: DailyRecordKind;

  @ApiProperty({
    description: 'Date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiPropertyOptional({ description: 'Short label.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Measured value.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  value?: string;

  @ApiPropertyOptional({ description: 'Unit label.', example: 'bpm' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateDailyRecordDto {
  @ApiPropertyOptional({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  @IsOptional()
  @IsEnum(DailyRecordKind)
  kind?: DailyRecordKind;

  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({
    description: 'Short label. Use null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @ApiPropertyOptional({
    description: 'Measured value. Use null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  value?: string | null;

  @ApiPropertyOptional({
    description: 'Unit label. Use null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @ApiPropertyOptional({
    description: 'Free-text note. Use null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class QueryDailyRecordDto {
  @ApiProperty({
    description: 'Date in YYYY-MM-DD format.',
    example: '2026-06-04',
  })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ enum: DailyRecordKind, enumName: 'DailyRecordKind' })
  @IsOptional()
  @IsEnum(DailyRecordKind)
  kind?: DailyRecordKind;

  @ApiPropertyOptional({ description: 'Page number (1-based).', example: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: 'Page size.', example: 50 })
  @IsOptional()
  @IsString()
  pageSize?: string;
}
