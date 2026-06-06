import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DailyRecordKind } from '../../../generated/prisma/client';
import { DailyRecordAttachmentInputDto } from './daily-record-attachment.dto';

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

  @ApiPropertyOptional({
    type: () => DailyRecordAttachmentInputDto,
    isArray: true,
    description:
      'Replacement attachment metadata list. Omit to keep existing attachments; send [] to clear.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyRecordAttachmentInputDto)
  attachments?: DailyRecordAttachmentInputDto[];
}
