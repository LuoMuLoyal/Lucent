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
 *
 * `water` and `sleep` are each controlled by their own share-field toggle
 * (R-2): when the field is not selected the entry is set to `undefined` so
 * no output path leaks the coverage. `checkIns` and `dose` are always
 * present (they are not one of the six selectable fields).
 */
export class ClinicSummaryCoverageDto {
  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  checkIns!: ClinicSummaryCoverageEntryDto;

  @ApiPropertyOptional({
    type: () => ClinicSummaryCoverageEntryDto,
    description:
      'Water coverage. Optional: omitted when the `water` field is ' +
      'deselected via selectedFields.',
  })
  water?: ClinicSummaryCoverageEntryDto;

  @ApiProperty({ type: () => ClinicSummaryCoverageEntryDto })
  dose!: ClinicSummaryCoverageEntryDto;

  @ApiPropertyOptional({
    type: () => ClinicSummaryCoverageEntryDto,
    description:
      'Sleep coverage. Optional: omitted when the `sleep` field is ' +
      'deselected via selectedFields.',
  })
  sleep?: ClinicSummaryCoverageEntryDto;
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

/**
 * A daily water intake fact — only records with a parsable ml value are
 * included (R-2). No trend is computed for a single data point; at least two
 * different dates are required for any trend conclusion.
 */
export class ClinicSummaryWaterEntryDto {
  @ApiProperty({ description: 'Calendar date in YYYY-MM-DD format.' })
  date!: string;

  @ApiProperty({ description: 'Water intake in milliliters.' })
  ml!: number;
}

/**
 * A daily sleep duration fact — only records with a positive duration are
 * included (R-2). No trend is computed for a single data point.
 */
export class ClinicSummarySleepEntryDto {
  @ApiProperty({ description: 'Calendar date in YYYY-MM-DD format.' })
  date!: string;

  @ApiProperty({ description: 'Sleep duration in minutes.' })
  minutes!: number;
}

/**
 * A free-text note record — date, record kind, and the original note text.
 * Controlled by the `notes` field toggle (R-2); defaults to off so the user
 * must explicitly opt in before notes appear in preview / PDF / share.
 */
export class ClinicSummaryNoteEntryDto {
  @ApiProperty({ description: 'Calendar date in YYYY-MM-DD format.' })
  date!: string;

  @ApiProperty({
    description:
      'Daily record kind (water/meal/vital/mood/symptom/activity/note/sleep).',
  })
  kind!: string;

  @ApiProperty({ description: 'Original note text.' })
  text!: string;
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

  @ApiPropertyOptional({
    type: () => ClinicSummaryProfileDto,
    description:
      'De-identified profile. Optional: omitted when the section is ' +
      'deselected via selectedFields.',
  })
  profile?: ClinicSummaryProfileDto;

  @ApiPropertyOptional({
    type: () => ClinicSummaryAllergyDto,
    isArray: true,
    description:
      'Active allergies. Optional: omitted when the section is deselected.',
  })
  allergies?: ClinicSummaryAllergyDto[];

  @ApiPropertyOptional({
    type: () => ClinicSummaryConditionDto,
    isArray: true,
    description:
      'Active conditions. Optional: omitted when the section is deselected.',
  })
  conditions?: ClinicSummaryConditionDto[];

  @ApiPropertyOptional({
    type: () => ClinicSummaryMedicineDto,
    isArray: true,
    description:
      'Current medicines. Optional: omitted when the section is deselected.',
  })
  currentMedicines?: ClinicSummaryMedicineDto[];

  @ApiPropertyOptional({
    description:
      'Structured facts and change codes reused from the event review ' +
      '(e.g. health_event, observed_changes, no_completed_actions, ' +
      'active_check_in). `insufficient_coverage` is the fixed 资料不足 ' +
      'statement — no generic AI conclusions are ever added. ' +
      'Controlled by the `event_overview` field toggle (R-2): omitted ' +
      'when the field is deselected.',
  })
  findings?: string[];

  @ApiPropertyOptional({
    type: () => ClinicSummaryWaterEntryDto,
    isArray: true,
    description:
      'Daily water intake facts (only records with a parsable ml value). ' +
      'Controlled by the `water` field toggle (R-2): omitted when the ' +
      'field is deselected.',
  })
  waterEntries?: ClinicSummaryWaterEntryDto[];

  @ApiPropertyOptional({
    type: () => ClinicSummarySleepEntryDto,
    isArray: true,
    description:
      'Daily sleep duration facts (only records with a positive duration). ' +
      'Controlled by the `sleep` field toggle (R-2): omitted when the ' +
      'field is deselected.',
  })
  sleepEntries?: ClinicSummarySleepEntryDto[];

  @ApiPropertyOptional({
    type: () => ClinicSummaryNoteEntryDto,
    isArray: true,
    description:
      'Free-text note records (date, kind, original text). Controlled ' +
      'by the `notes` field toggle (R-2): omitted when the field is ' +
      'deselected. Defaults to off — the user must explicitly opt in.',
  })
  noteEntries?: ClinicSummaryNoteEntryDto[];

  @ApiProperty({ description: 'Disclaimer text' })
  disclaimer!: string;
}

export class ClinicSummaryResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => ClinicSummaryDto })
  data!: ClinicSummaryDto;
}

export class ClinicSummaryShareScopeDto {
  @ApiProperty({ type: String, nullable: true, description: 'Event scope id' })
  eventId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Date-range scope start (ISO 8601), or null for an event scope',
  })
  dateFrom!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Date-range scope end (ISO 8601), or null for an event scope',
  })
  dateTo!: string | null;
}

export class ClinicSummaryShareDataDto {
  @ApiPropertyOptional({
    description:
      'Persisted share record id (used for revocation). Always present on ' +
      'the create response; optional only because the legacy ' +
      '`createShareLink` service method (cache-only shares) does not emit it.',
  })
  shareId?: string;

  @ApiPropertyOptional({
    description:
      'Plaintext token — returned exactly once at creation, never persisted or logged',
  })
  token?: string;

  @ApiProperty({ description: 'Shareable URL' })
  shareUrl!: string;

  @ApiProperty({ description: 'Expiration time (ISO 8601)' })
  expiresAt!: string;

  @ApiPropertyOptional({ type: () => ClinicSummaryShareScopeDto })
  scope?: ClinicSummaryShareScopeDto;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: 'Share fields the link may expose',
  })
  selectedFields?: string[];
}

export class ClinicSummaryShareResponseDto {
  @ApiProperty({ description: 'Result code.', example: 0 })
  code!: number;

  @ApiProperty({ description: 'Message.', example: '' })
  message!: string;

  @ApiProperty({ type: () => ClinicSummaryShareDataDto })
  data!: ClinicSummaryShareDataDto;
}
