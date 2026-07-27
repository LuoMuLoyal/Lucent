import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MedicineSource,
  SexAtBirth,
  UnitSystem,
  UserAllergyKind,
  UserAllergySeverity,
  UserConditionStatus,
} from '#generated/prisma/client';

class UserHealthSummaryDto {
  @ApiProperty({
    description:
      'Age derived from birth date. Null when birth date is missing.',
    example: 28,
    nullable: true,
    type: Number,
  })
  age!: number | null;

  @ApiProperty({
    description: 'Whether the onboarding flow has been completed.',
    example: true,
  })
  onboardingCompleted!: boolean;

  @ApiProperty({
    description: 'Number of active allergy records returned in this payload.',
    example: 2,
  })
  activeAllergyCount!: number;

  @ApiProperty({
    description: 'Number of condition records returned in this payload.',
    example: 3,
  })
  conditionCount!: number;

  @ApiProperty({
    description: 'Number of current medicine records returned in this payload.',
    example: 1,
  })
  currentMedicineCount!: number;

  @ApiProperty({
    description:
      'Missing core profile fields that the frontend can use for onboarding nudges.',
    example: ['birthDate', 'heightCm'],
    type: [String],
  })
  missingCoreProfileFields!: string[];
}

class EmergencyContactDto {
  @ApiProperty({
    description: 'Emergency contact name.',
    example: '张三',
    nullable: true,
    type: String,
  })
  name!: string | null;

  @ApiProperty({
    description: 'Emergency contact phone.',
    example: '13800138000',
    nullable: true,
    type: String,
  })
  phone!: string | null;
}

class UserHealthProfileDto {
  @ApiProperty({
    description: 'Birth date in YYYY-MM-DD format.',
    example: '1998-03-15',
    nullable: true,
    type: String,
  })
  birthDate!: string | null;

  @ApiPropertyOptional({
    description: 'Sex assigned at birth.',
    enum: SexAtBirth,
    enumName: 'SexAtBirth',
    example: SexAtBirth.female,
  })
  sexAtBirth!: SexAtBirth | null;

  @ApiProperty({
    description: 'Height in centimeters.',
    example: 168,
    nullable: true,
    type: Number,
  })
  heightCm!: number | null;

  @ApiProperty({
    description: 'Weight in kilograms. Extracted from extras JSONB.',
    example: 65,
    nullable: true,
    type: Number,
  })
  weightKg!: number | null;

  @ApiProperty({
    description: 'Blood type.',
    example: 'O+',
    nullable: true,
    type: String,
  })
  bloodType!: string | null;

  @ApiProperty({
    description: 'Preferred locale.',
    example: 'en-US',
    nullable: true,
    type: String,
  })
  locale!: string | null;

  @ApiProperty({
    description: 'Preferred timezone.',
    example: 'Asia/Shanghai',
    nullable: true,
    type: String,
  })
  timezone!: string | null;

  @ApiPropertyOptional({
    description: 'Preferred unit system.',
    enum: UnitSystem,
    enumName: 'UnitSystem',
    example: UnitSystem.metric,
  })
  unitSystem!: UnitSystem | null;

  @ApiProperty({
    description: 'When the onboarding flow was completed.',
    example: '2026-05-30T09:00:00.000Z',
    nullable: true,
    type: String,
  })
  onboardingCompletedAt!: string | null;

  @ApiProperty({
    description: 'Emergency contact extracted from extras JSONB.',
    type: () => EmergencyContactDto,
    nullable: true,
  })
  emergencyContact!: EmergencyContactDto | null;

  @ApiProperty({
    description: 'Sparse profile extensions stored in jsonb.',
    nullable: true,
    type: Object,
    additionalProperties: true,
    example: {
      preferredReminderHour: 9,
    },
  })
  extras!: unknown;
}

class UserAllergyItemDto {
  @ApiProperty({ description: 'Allergy id.' })
  id!: string;

  @ApiProperty({
    description: 'Allergy kind.',
    enum: UserAllergyKind,
    enumName: 'UserAllergyKind',
    example: UserAllergyKind.drug,
  })
  kind!: UserAllergyKind;

  @ApiProperty({
    description: 'User-visible allergy label.',
    example: 'Penicillin',
  })
  label!: string;

  @ApiProperty({
    description: 'Recorded reaction.',
    example: 'Rash',
    nullable: true,
    type: String,
  })
  reaction!: string | null;

  @ApiPropertyOptional({
    description: 'Severity level.',
    enum: UserAllergySeverity,
    enumName: 'UserAllergySeverity',
    example: UserAllergySeverity.moderate,
  })
  severity!: UserAllergySeverity | null;

  @ApiProperty({ description: 'Whether the allergy is currently active.' })
  isActive!: boolean;

  @ApiProperty({
    description: 'User note for the allergy.',
    example: 'Avoid completely',
    nullable: true,
    type: String,
  })
  note!: string | null;

  @ApiProperty({
    description: 'Sparse allergy extensions stored in jsonb.',
    nullable: true,
    type: Object,
    additionalProperties: true,
    example: {
      source: 'manual',
    },
  })
  extras!: unknown;

  @ApiProperty({
    description: 'When this allergy was recorded.',
    example: '2026-05-20T09:00:00.000Z',
    nullable: true,
    type: String,
  })
  recordedAt!: string | null;

  @ApiProperty({
    description: 'Created time in ISO 8601 format.',
    example: '2026-05-20T09:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Updated time in ISO 8601 format.',
    example: '2026-05-21T09:00:00.000Z',
  })
  updatedAt!: string;
}

class UserConditionItemDto {
  @ApiProperty({ description: 'Condition id.' })
  id!: string;

  @ApiProperty({
    description: 'Condition label.',
    example: 'Asthma',
  })
  label!: string;

  @ApiProperty({
    description: 'Condition status.',
    enum: UserConditionStatus,
    enumName: 'UserConditionStatus',
    example: UserConditionStatus.active,
  })
  status!: UserConditionStatus;

  @ApiProperty({
    description: 'Diagnosis date in YYYY-MM-DD format.',
    example: '2024-02-01',
    nullable: true,
    type: String,
  })
  diagnosedAt!: string | null;

  @ApiProperty({
    description: 'Resolved date in YYYY-MM-DD format.',
    example: '2025-03-12',
    nullable: true,
    type: String,
  })
  resolvedAt!: string | null;

  @ApiProperty({
    description: 'User note for the condition.',
    example: 'Triggered during pollen season',
    nullable: true,
    type: String,
  })
  note!: string | null;

  @ApiProperty({
    description: 'Sparse condition extensions stored in jsonb.',
    nullable: true,
    type: Object,
    additionalProperties: true,
  })
  extras!: unknown;

  @ApiProperty({
    description: 'Created time in ISO 8601 format.',
    example: '2024-02-01T00:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Updated time in ISO 8601 format.',
    example: '2026-05-18T00:00:00.000Z',
  })
  updatedAt!: string;
}

class UserCurrentMedicineItemDto {
  @ApiProperty({ description: 'Current medicine id.' })
  id!: string;

  @ApiProperty({
    description: 'Upstream source used to anchor this medicine.',
    enum: MedicineSource,
    enumName: 'MedicineSource',
    example: MedicineSource.drugbank,
  })
  source!: MedicineSource;

  @ApiProperty({
    description: 'Source-specific reference id.',
    example: 'DB01050',
    nullable: true,
    type: String,
  })
  sourceRefId!: string | null;

  @ApiProperty({
    description: 'Display name shown to the user.',
    example: 'Ibuprofen',
  })
  displayName!: string;

  @ApiProperty({
    description: 'Strength text.',
    example: '200 mg',
    nullable: true,
    type: String,
  })
  strengthText!: string | null;

  @ApiProperty({
    description: 'Dose text.',
    example: '1 tablet after meals',
    nullable: true,
    type: String,
  })
  doseText!: string | null;

  @ApiProperty({
    description: 'Administration route.',
    example: 'oral',
    nullable: true,
    type: String,
  })
  route!: string | null;

  @ApiProperty({
    description: 'Start date in YYYY-MM-DD format.',
    example: '2026-05-01',
    nullable: true,
    type: String,
  })
  startedAt!: string | null;

  @ApiProperty({
    description: 'End date in YYYY-MM-DD format.',
    example: '2026-05-07',
    nullable: true,
    type: String,
  })
  endedAt!: string | null;

  @ApiProperty({ description: 'Whether the medicine is currently active.' })
  isCurrent!: boolean;

  @ApiProperty({
    description: 'User note for the medicine.',
    example: 'Use only when needed for headaches',
    nullable: true,
    type: String,
  })
  note!: string | null;

  @ApiProperty({
    description: 'Original source payload stored in jsonb.',
    nullable: true,
    type: Object,
    additionalProperties: true,
  })
  sourcePayload!: unknown;

  @ApiProperty({
    description: 'Created time in ISO 8601 format.',
    example: '2026-05-01T00:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Updated time in ISO 8601 format.',
    example: '2026-05-21T00:00:00.000Z',
  })
  updatedAt!: string;
}

class HealthContextDataDto {
  @ApiProperty({ type: () => UserHealthSummaryDto })
  summary!: UserHealthSummaryDto;

  @ApiProperty({ type: () => UserHealthProfileDto })
  profile!: UserHealthProfileDto;

  @ApiProperty({ type: () => UserAllergyItemDto, isArray: true })
  allergies!: UserAllergyItemDto[];

  @ApiProperty({ type: () => UserConditionItemDto, isArray: true })
  conditions!: UserConditionItemDto[];

  @ApiProperty({ type: () => UserCurrentMedicineItemDto, isArray: true })
  currentMedicines!: UserCurrentMedicineItemDto[];
}

export class HealthContextResponseDto {
  @ApiProperty({ description: 'Result code', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Prompt message', example: '' })
  message!: string;

  @ApiProperty({ type: () => HealthContextDataDto })
  data!: HealthContextDataDto;
}

export type HealthContextResponseData = HealthContextDataDto;
