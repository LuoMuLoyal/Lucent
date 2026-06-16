import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  DEFAULT_MEDICINE_SOURCE,
  MEDICINE_KNOWLEDGE_SOURCES,
} from './medicine-source.dto';

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export class MedicineSearchQueryDto {
  @ApiPropertyOptional({
    description: 'Knowledge source selector.',
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    default: DEFAULT_MEDICINE_SOURCE,
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Search keyword.',
    example: 'ibuprofen',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) => trimOptionalString(value))
  q?: string;

  @ApiPropertyOptional({
    description: 'Page number, 1-based.',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: 'Page size.',
    example: 20,
    default: 20,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class MedicineDetailQueryDto {
  @ApiPropertyOptional({
    description: 'Knowledge source selector.',
    enum: MEDICINE_KNOWLEDGE_SOURCES,
    default: DEFAULT_MEDICINE_SOURCE,
  })
  @IsOptional()
  @IsString()
  source?: string;
}
