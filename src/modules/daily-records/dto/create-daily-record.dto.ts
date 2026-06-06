import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
