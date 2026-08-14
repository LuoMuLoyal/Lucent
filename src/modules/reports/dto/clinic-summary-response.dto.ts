import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ObservedMetricCoverage,
  ObservedMetricSource,
  ObservedMetricState,
} from '../../../common';

export class ClinicSummaryCoverageEntryDto {
  @ApiProperty({ enum: ['observed', 'unknown'] })
  state!: ObservedMetricState;

  @ApiProperty({
    enum: ['sufficient', 'partial', 'none'],
    description:
      "'none' when the source has no observations; 'partial' when " +
      'observations exist but sufficiency is not assessed.',
  })
  coverage!: ObservedMetricCoverage;

  @ApiProperty({
    enum: ['manual', 'health_platform', 'reminder_plan', 'derived'],
    isArray: true,
  })
  sources!: ObservedMetricSource[];

  @ApiProperty({ description: 'Number of observations in the window.' })
  observedCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'No fixed expectation is defined yet.',
  })
  expectedCount!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Window start (ISO 8601), or null when nothing was observed.',
  })
  windowStart!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Window end (ISO 8601), or null when nothing was observed.',
  })
  windowEnd!: string | null;
}

/**
 * Unified water/dose/sleep coverage reused from the event review read model.
 * `water` and `sleep` both derive from daily records; `dose` from dose logs;
 * `checkIns` is the check-in source. All entries share the observed-metric
 * contract so the summary never re-implements aggregation rules.
 */
export class ClinicSummaryCoverageDto {
  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  checkIns!: ClinicSummaryCoverageEntryDto;

  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  water!: ClinicSummaryCoverageEntryDto;

  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  dose!: ClinicSummaryCoverageEntryDto;

  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  sleep!: ClinicSummaryCoverageEntryDto;
}

export class ClinicSummaryProfileDto {
  @ApiProperty({ description: 'Masked display name (e.g. 张**)' })
  nickname!: string;

  @ApiPropertyOptional({
    description: 'Age in years (derived from birthDate, never raw date)',
    type: Number,
    nullable: true,
  })
  age?: number | null;

  @ApiProperty({ description: 'Sex at birth', type: String, nullable: true })
  sexAtBirth!: string | null;

  @ApiPropertyOptional({
    description: 'Blood type',
    type: String,
    nullable: true,
  })
  bloodType?: string | null;
}

export class ClinicSummaryAllergyDto {
  @ApiProperty({ description: 'Allergy label (e.g. 青霉素)' })
  label!: string;

  @ApiProperty({
    description: 'Reaction description',
    type: String,
    nullable: true,
  })
  reaction!: string | null;

  @ApiProperty({ description: 'Severity level', type: String, nullable: true })
  severity!: string | null;
}

export class ClinicSummaryConditionDto {
  @ApiProperty({ description: 'Condition label (e.g. 高血压)' })
  label!: string;

  @ApiProperty({ description: 'Current status', type: String, nullable: true })
  status!: string | null;

  @ApiPropertyOptional({
    description: 'Year of diagnosis (YYYY)',
    type: Number,
    nullable: true,
  })
  diagnosedYear?: number | null;
}

export class ClinicSummaryMedicineDto {
  @ApiProperty({ description: 'Generic medicine name' })
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Dose instruction',
    type: String,
    nullable: true,
  })
  doseText?: string | null;
}

export class ClinicSummaryDto {
  @ApiProperty({ description: 'Generated timestamp' })
  generatedAt!: string;

  @ApiProperty({
    description:
      'Scope label: last_7_days | last_30_days | custom for date-range ' +
      'scopes, or the event title for an event scope.',
  })
  scopeLabel!: string;

  @ApiProperty({ description: 'Real window start (ISO 8601).' })
  start!: string;

  @ApiProperty({ description: 'Real window end (ISO 8601).' })
  end!: string;

  @ApiProperty({
    type: String,
    isArray: true,
    description:
      'Effective included sections after field selection ' +
      '(profile/allergies/conditions/currentMedicines).',
  })
  selectedFields!: string[];

  @ApiProperty({ type: () => ClinicSummaryCoverageDto })
  coverage!: ClinicSummaryCoverageDto;

  @ApiProperty({
    description:
      'Legacy range label (last_7_days | last_30_days | custom | event); ' +
      'kept as a compatibility alias of scopeLabel.',
  })
  dataRange!: string;

  @ApiProperty({ description: 'De-identified profile' })
  profile!: ClinicSummaryProfileDto;

  @ApiProperty({ description: 'Active allergies' })
  allergies!: ClinicSummaryAllergyDto[];

  @ApiProperty({ description: 'Active conditions' })
  conditions!: ClinicSummaryConditionDto[];

  @ApiProperty({ description: 'Current medicines' })
  currentMedicines!: ClinicSummaryMedicineDto[];

  @ApiPropertyOptional({
    description:
      'Structured facts and change codes reused from the event review ' +
      '(e.g. health_event, observed_changes, no_completed_actions, ' +
      'active_check_in). `insufficient_coverage` is the fixed 资料不足 ' +
      'statement — no generic AI conclusions are ever added.',
  })
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
