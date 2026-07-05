import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { DailyRecordKind } from '#generated/prisma/client';

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
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (1-100).', example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
