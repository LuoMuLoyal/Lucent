import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DoseLogStatus } from '#generated/prisma/client';

export class UpdateDoseLogDto {
  @ApiPropertyOptional({ enum: DoseLogStatus, enumName: 'DoseLogStatus' })
  @IsOptional()
  @IsEnum(DoseLogStatus)
  status?: DoseLogStatus;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  doseText?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note?: string | null;
}
