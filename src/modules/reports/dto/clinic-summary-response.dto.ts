import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClinicSummaryProfileDto {
  @ApiProperty({ description: 'Masked display name (e.g. 张**)' })
  nickname!: string;

  @ApiPropertyOptional({
    description: 'Age in years (derived from birthDate, never raw date)',
  })
  age?: number | null;

  @ApiProperty({ description: 'Sex at birth' })
  sexAtBirth!: string | null;

  @ApiPropertyOptional({ description: 'Blood type' })
  bloodType?: string | null;
}

export class ClinicSummaryAllergyDto {
  @ApiProperty({ description: 'Allergy label (e.g. 青霉素)' })
  label!: string;

  @ApiProperty({ description: 'Reaction description' })
  reaction!: string | null;

  @ApiProperty({ description: 'Severity level' })
  severity!: string | null;
}

export class ClinicSummaryConditionDto {
  @ApiProperty({ description: 'Condition label (e.g. 高血压)' })
  label!: string;

  @ApiProperty({ description: 'Current status' })
  status!: string | null;

  @ApiPropertyOptional({ description: 'Year of diagnosis (YYYY)' })
  diagnosedYear?: number | null;
}

export class ClinicSummaryMedicineDto {
  @ApiProperty({ description: 'Generic medicine name' })
  displayName!: string;

  @ApiPropertyOptional({ description: 'Dose instruction' })
  doseText?: string | null;
}

export class ClinicSummaryDto {
  @ApiProperty({ description: 'Generated timestamp' })
  generatedAt!: string;

  @ApiProperty({ description: 'Data range (e.g. last_30_days)' })
  dataRange!: string;

  @ApiProperty({ description: 'De-identified profile' })
  profile!: ClinicSummaryProfileDto;

  @ApiProperty({ description: 'Active allergies' })
  allergies!: ClinicSummaryAllergyDto[];

  @ApiProperty({ description: 'Active conditions' })
  conditions!: ClinicSummaryConditionDto[];

  @ApiProperty({ description: 'Current medicines' })
  currentMedicines!: ClinicSummaryMedicineDto[];

  @ApiPropertyOptional({ description: 'Key findings / notes for the doctor' })
  findings?: string[];

  @ApiProperty({ description: 'Disclaimer text' })
  disclaimer!: string;
}

export class ClinicSummaryShareResponseDto {
  @ApiProperty({ description: 'Shareable URL' })
  shareUrl!: string;

  @ApiProperty({ description: 'Expiration time (ISO 8601)' })
  expiresAt!: string;
}
