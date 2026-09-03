import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MedicineSource } from '#generated/prisma/client.js';

export class UpdateCurrentMedicineDto {
  @ApiPropertyOptional({
    description: 'Upstream source.',
    enum: MedicineSource,
    enumName: 'MedicineSource',
  })
  @IsOptional()
  @IsEnum(MedicineSource)
  source?: MedicineSource;

  @ApiPropertyOptional({
    description: 'Source-specific reference id.',
    example: 'DB01050',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceRefId?: string | null;

  @ApiPropertyOptional({
    description: 'Display name shown to the user.',
    example: 'Ibuprofen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Strength text. Use null to clear.',
    example: '200 mg',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  strengthText?: string | null;

  @ApiPropertyOptional({
    description: 'Dose text. Use null to clear.',
    example: '1 tablet after meals',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  doseText?: string | null;

  @ApiPropertyOptional({
    description: 'Administration route. Use null to clear.',
    example: 'oral',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string | null;

  @ApiPropertyOptional({
    description: 'Start date in YYYY-MM-DD format. Use null to clear.',
    example: '2026-06-03',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startedAt must be in YYYY-MM-DD format',
  })
  startedAt?: string | null;

  @ApiPropertyOptional({
    description: 'End date in YYYY-MM-DD format. Use null to clear.',
    example: '2026-06-10',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endedAt must be in YYYY-MM-DD format',
  })
  endedAt?: string | null;

  @ApiPropertyOptional({
    description: 'User note. Use null to clear.',
    example: 'Use only when needed for headaches',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @ApiPropertyOptional({
    description: 'Whether the medicine is currently active.',
  })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
