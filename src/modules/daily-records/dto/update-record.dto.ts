import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  Matches,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DailyRecordKind } from '#generated/prisma/client';
import { DailyRecordAttachmentInputDto } from './record-attachment.dto';

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
    description: 'Time in HH:mm 24-hour format. Use null to clear.',
    example: '09:45',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  occurredTime?: string | null;

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
    description:
      'Structured payload for kind-specific data. Use null to clear.',
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown> | null;

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
