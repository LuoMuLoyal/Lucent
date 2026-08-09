import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { DoseLogStatus } from '#generated/prisma/client';

export class CreateDoseLogDto {
  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currentMedicineId?: string;

  @ApiPropertyOptional({
    description: 'Linked reminder id for slot-aware logs.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reminderId?: string;

  @ApiPropertyOptional({
    description: 'Linked active health event id.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  healthEventId?: string | null;

  @ApiProperty({
    enum: DoseLogStatus,
    enumName: 'DoseLogStatus',
    example: 'taken',
  })
  @IsEnum(DoseLogStatus)
  status!: DoseLogStatus;

  @ApiProperty({
    description: 'Scheduled date YYYY-MM-DD.',
    example: '2026-06-04',
  })
  @IsDateString()
  scheduledFor!: string;

  @ApiPropertyOptional({
    description: 'Scheduled slot time in HH:mm.',
    example: '08:30',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  scheduledTime?: string;

  @ApiPropertyOptional({ description: 'Dose text.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  doseText?: string;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
