import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { DoseLogStatus } from '../../../generated/prisma/client';

export class UpdateDoseLogDto {
  @ApiPropertyOptional({ enum: DoseLogStatus, enumName: 'DoseLogStatus' })
  @IsOptional()
  @IsEnum(DoseLogStatus)
  status?: DoseLogStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  doseText?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
