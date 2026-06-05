import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DailyRecordKind } from '../../../generated/prisma/client';

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
