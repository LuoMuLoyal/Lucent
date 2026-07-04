import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DoseLogStatus } from '#generated/prisma/client';

export class CreateDoseLogDto {
  @ApiPropertyOptional({ description: 'Linked current medicine id.' })
  @IsOptional()
  @IsString()
  currentMedicineId?: string;

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

  @ApiPropertyOptional({ description: 'Dose text.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doseText?: string;

  @ApiPropertyOptional({ description: 'Free-text note.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
