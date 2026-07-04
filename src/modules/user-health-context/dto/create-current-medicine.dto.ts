import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MedicineSource } from '#generated/prisma/client';

export class CreateCurrentMedicineDto {
  @ApiProperty({
    description: 'Upstream source used to anchor this medicine.',
    enum: MedicineSource,
    enumName: 'MedicineSource',
    example: MedicineSource.drugbank,
  })
  @IsEnum(MedicineSource)
  source!: MedicineSource;

  @ApiPropertyOptional({
    description:
      'Source-specific reference id. Required for drugbank and cn sources.',
    example: 'DB01050',
  })
  @ValidateIf((o: CreateCurrentMedicineDto) =>
    o.source === MedicineSource.drugbank || o.source === MedicineSource.cn
      ? true
      : false,
  )
  @IsString()
  @IsNotEmpty()
  sourceRefId?: string;

  @ApiProperty({
    description: 'Display name shown to the user.',
    example: 'Ibuprofen',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Strength text.',
    example: '200 mg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  strengthText?: string;

  @ApiPropertyOptional({
    description: 'Dose text.',
    example: '1 tablet after meals',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  doseText?: string;

  @ApiPropertyOptional({
    description: 'Administration route.',
    example: 'oral',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string;

  @ApiPropertyOptional({
    description: 'Start date in YYYY-MM-DD format.',
    example: '2026-06-03',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startedAt must be in YYYY-MM-DD format',
  })
  startedAt?: string | null;

  @ApiPropertyOptional({
    description: 'End date in YYYY-MM-DD format.',
    example: '2026-06-10',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endedAt must be in YYYY-MM-DD format',
  })
  endedAt?: string | null;

  @ApiPropertyOptional({
    description: 'User note for the medicine.',
    example: 'Use only when needed for headaches',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
