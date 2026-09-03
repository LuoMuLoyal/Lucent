import { z } from 'zod';

/**
 * Unified observed-metric coverage entry reused from the event review read
 * model. `state`/`coverage`/`sources` mirror the shared observed-metric
 * contract so the summary never re-implements aggregation rules.
 *
 * Replaces the former `@ApiProperty` response class
 * `ClinicSummaryCoverageEntryDto`.
 */
export const clinicSummaryCoverageEntrySchema = z.object({
  state: z.enum(['observed', 'unknown']),
  coverage: z
    .enum(['sufficient', 'partial', 'none'])
    .describe(
      "'none' when the source has no observations; 'partial' when " +
        'observations exist but sufficiency is not assessed.',
    ),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z.number().describe('Number of observations in the window.'),
  expectedCount: z
    .number()
    .nullable()
    .describe('No fixed expectation is defined yet.'),
  windowStart: z
    .string()
    .nullable()
    .describe('Window start (ISO 8601), or null when nothing was observed.'),
  windowEnd: z
    .string()
    .nullable()
    .describe('Window end (ISO 8601), or null when nothing was observed.'),
});

/** Strongly typed coverage entry of one observed-metric source. */
export type ClinicSummaryCoverageEntryDto = z.infer<
  typeof clinicSummaryCoverageEntrySchema
>;

/**
 * Unified water/dose/sleep coverage reused from the event review read model.
 * `water` and `sleep` both derive from daily records; `dose` from dose logs;
 * `checkIns` is the check-in source. All entries share the observed-metric
 * contract so the summary never re-implements aggregation rules.
 *
 * `water` and `sleep` are each controlled by their own share-field toggle
 * (R-2): when the field is not selected the entry is omitted so no output
 * path leaks the coverage. `checkIns` and `dose` are always present (they
 * are not one of the six selectable fields).
 *
 * Replaces the former `@ApiProperty` response class
 * `ClinicSummaryCoverageDto`.
 */
export const clinicSummaryCoverageSchema = z.object({
  checkIns: clinicSummaryCoverageEntrySchema,
  water: clinicSummaryCoverageEntrySchema
    .optional()
    .describe(
      'Water coverage. Optional: omitted when the `water` field is ' +
        'deselected via selectedFields.',
    ),
  dose: clinicSummaryCoverageEntrySchema,
  sleep: clinicSummaryCoverageEntrySchema
    .optional()
    .describe(
      'Sleep coverage. Optional: omitted when the `sleep` field is ' +
        'deselected via selectedFields.',
    ),
});

/** Strongly typed coverage block of the clinic summary payload. */
export type ClinicSummaryCoverageDto = z.infer<
  typeof clinicSummaryCoverageSchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryProfileDto`. */
export const clinicSummaryProfileSchema = z.object({
  nickname: z.string().describe('Masked display name (e.g. 张**)'),
  age: z
    .number()
    .nullable()
    .optional()
    .describe('Age in years (derived from birthDate, never raw date)'),
  sexAtBirth: z.string().nullable().describe('Sex at birth'),
  bloodType: z.string().nullable().optional().describe('Blood type'),
});

/** Strongly typed de-identified profile block of the clinic summary. */
export type ClinicSummaryProfileDto = z.infer<
  typeof clinicSummaryProfileSchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryAllergyDto`. */
export const clinicSummaryAllergySchema = z.object({
  label: z.string().describe('Allergy label (e.g. 青霉素)'),
  reaction: z.string().nullable().describe('Reaction description'),
  severity: z.string().nullable().describe('Severity level'),
});

/** Strongly typed allergy entry of the clinic summary. */
export type ClinicSummaryAllergyDto = z.infer<
  typeof clinicSummaryAllergySchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryConditionDto`. */
export const clinicSummaryConditionSchema = z.object({
  label: z.string().describe('Condition label (e.g. 高血压)'),
  status: z.string().nullable().describe('Current status'),
  diagnosedYear: z
    .number()
    .nullable()
    .optional()
    .describe('Year of diagnosis (YYYY)'),
});

/** Strongly typed condition entry of the clinic summary. */
export type ClinicSummaryConditionDto = z.infer<
  typeof clinicSummaryConditionSchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryMedicineDto`. */
export const clinicSummaryMedicineSchema = z.object({
  displayName: z.string().describe('Generic medicine name'),
  doseText: z.string().nullable().optional().describe('Dose instruction'),
});

/** Strongly typed current-medicine entry of the clinic summary. */
export type ClinicSummaryMedicineDto = z.infer<
  typeof clinicSummaryMedicineSchema
>;

/**
 * A daily water intake fact — only records with a parsable ml value are
 * included (R-2). No trend is computed for a single data point; at least two
 * different dates are required for any trend conclusion.
 *
 * Replaces the former `@ApiProperty` response class
 * `ClinicSummaryWaterEntryDto`.
 */
export const clinicSummaryWaterEntrySchema = z.object({
  date: z.string().describe('Calendar date in YYYY-MM-DD format.'),
  ml: z.number().describe('Water intake in milliliters.'),
});

/** Strongly typed daily water-intake fact of the clinic summary. */
export type ClinicSummaryWaterEntryDto = z.infer<
  typeof clinicSummaryWaterEntrySchema
>;

/**
 * A daily sleep duration fact — only records with a positive duration are
 * included (R-2). No trend is computed for a single data point.
 *
 * Replaces the former `@ApiProperty` response class
 * `ClinicSummarySleepEntryDto`.
 */
export const clinicSummarySleepEntrySchema = z.object({
  date: z.string().describe('Calendar date in YYYY-MM-DD format.'),
  minutes: z.number().describe('Sleep duration in minutes.'),
});

/** Strongly typed daily sleep-duration fact of the clinic summary. */
export type ClinicSummarySleepEntryDto = z.infer<
  typeof clinicSummarySleepEntrySchema
>;

/**
 * A free-text note record — date, record kind, and the original note text.
 * Controlled by the `notes` field toggle (R-2); defaults to off so the user
 * must explicitly opt in before notes appear in preview / PDF / share.
 *
 * Replaces the former `@ApiProperty` response class
 * `ClinicSummaryNoteEntryDto`.
 */
export const clinicSummaryNoteEntrySchema = z.object({
  date: z.string().describe('Calendar date in YYYY-MM-DD format.'),
  kind: z
    .string()
    .describe(
      'Daily record kind (water/meal/vital/mood/symptom/activity/note/sleep).',
    ),
  text: z.string().describe('Original note text.'),
});

/** Strongly typed free-text note record of the clinic summary. */
export type ClinicSummaryNoteEntryDto = z.infer<
  typeof clinicSummaryNoteEntrySchema
>;

/**
 * Replaces the former `@ApiProperty` response class `ClinicSummaryDto` — the
 * shared data shape of the preview / share / export payloads.
 */
export const clinicSummarySchema = z.object({
  generatedAt: z.string().describe('Generated timestamp'),
  scopeLabel: z
    .string()
    .describe(
      'Scope label: last_7_days | last_30_days | custom for date-range ' +
        'scopes, or the event title for an event scope.',
    ),
  start: z.string().describe('Real window start (ISO 8601).'),
  end: z.string().describe('Real window end (ISO 8601).'),
  selectedFields: z
    .array(z.string())
    .describe(
      'Effective included sections after field selection ' +
        '(profile/allergies/conditions/currentMedicines).',
    ),
  coverage: clinicSummaryCoverageSchema,
  dataRange: z
    .string()
    .describe(
      'Legacy range label (last_7_days | last_30_days | custom | event); ' +
        'kept as a compatibility alias of scopeLabel.',
    ),
  profile: clinicSummaryProfileSchema
    .optional()
    .describe(
      'De-identified profile. Optional: omitted when the section is ' +
        'deselected via selectedFields.',
    ),
  allergies: z
    .array(clinicSummaryAllergySchema)
    .optional()
    .describe(
      'Active allergies. Optional: omitted when the section is deselected.',
    ),
  conditions: z
    .array(clinicSummaryConditionSchema)
    .optional()
    .describe(
      'Active conditions. Optional: omitted when the section is deselected.',
    ),
  currentMedicines: z
    .array(clinicSummaryMedicineSchema)
    .optional()
    .describe(
      'Current medicines. Optional: omitted when the section is deselected.',
    ),
  findings: z
    .array(z.string())
    .optional()
    .describe(
      'Structured facts and change codes reused from the event review ' +
        '(e.g. health_event, observed_changes, no_completed_actions, ' +
        'active_check_in). `insufficient_coverage` is the fixed 资料不足 ' +
        'statement — no generic AI conclusions are ever added. ' +
        'Controlled by the `event_overview` field toggle (R-2): omitted ' +
        'when the field is deselected.',
    ),
  waterEntries: z
    .array(clinicSummaryWaterEntrySchema)
    .optional()
    .describe(
      'Daily water intake facts (only records with a parsable ml value). ' +
        'Controlled by the `water` field toggle (R-2): omitted when the ' +
        'field is deselected.',
    ),
  sleepEntries: z
    .array(clinicSummarySleepEntrySchema)
    .optional()
    .describe(
      'Daily sleep duration facts (only records with a positive duration). ' +
        'Controlled by the `sleep` field toggle (R-2): omitted when the ' +
        'field is deselected.',
    ),
  noteEntries: z
    .array(clinicSummaryNoteEntrySchema)
    .optional()
    .describe(
      'Free-text note records (date, kind, original text). Controlled ' +
        'by the `notes` field toggle (R-2): omitted when the field is ' +
        'deselected. Defaults to off — the user must explicitly opt in.',
    ),
  disclaimer: z.string().describe('Disclaimer text'),
});

/** Strongly typed shared clinic summary data payload. */
export type ClinicSummaryDto = z.infer<typeof clinicSummarySchema>;

/**
 * Response schema of the clinic-summary payload endpoints — wire-identical to
 * {@link clinicSummarySchema}. Replaces the former response class
 * `ClinicSummaryResponseDto` (which extended `ClinicSummaryDto` without
 * adding fields).
 */
export const clinicSummaryResponseSchema = clinicSummarySchema;

/** Strongly typed clinic summary response body. */
export type ClinicSummaryResponseDto = z.infer<
  typeof clinicSummaryResponseSchema
>;

/** Exactly one of `jobId` and `pdfBase64` is present in the response. */
export const clinicSummaryExportAsyncResponseSchema = z.object({
  jobId: z.string().optional().describe('Queued PDF export job identifier.'),
  pdfBase64: z
    .string()
    .optional()
    .describe('Base64 PDF when the export is processed inline.'),
});

/** Strongly typed async clinic-summary export response body. */
export type ClinicSummaryExportAsyncResponseDto = z.infer<
  typeof clinicSummaryExportAsyncResponseSchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryShareScopeDto`. */
export const clinicSummaryShareScopeSchema = z.object({
  eventId: z.string().nullable().describe('Event scope id'),
  dateFrom: z
    .string()
    .nullable()
    .describe('Date-range scope start (ISO 8601), or null for an event scope'),
  dateTo: z
    .string()
    .nullable()
    .describe('Date-range scope end (ISO 8601), or null for an event scope'),
});

/** Strongly typed share scope of the clinic summary. */
export type ClinicSummaryShareScopeDto = z.infer<
  typeof clinicSummaryShareScopeSchema
>;

/** Replaces the former `@ApiProperty` response class `ClinicSummaryShareDataDto`. */
export const clinicSummaryShareDataSchema = z.object({
  shareId: z
    .string()
    .optional()
    .describe(
      'Persisted share record id (used for revocation). Always present on ' +
        'the create response; optional only because the legacy ' +
        '`createShareLink` service method (cache-only shares) does not emit it.',
    ),
  token: z
    .string()
    .optional()
    .describe(
      'Plaintext token — returned exactly once at creation, never persisted or logged',
    ),
  shareUrl: z.string().describe('Shareable URL'),
  expiresAt: z.string().describe('Expiration time (ISO 8601)'),
  scope: clinicSummaryShareScopeSchema.optional(),
  selectedFields: z
    .array(z.string())
    .optional()
    .describe('Share fields the link may expose'),
});

/** Strongly typed clinic-summary share data payload. */
export type ClinicSummaryShareDataDto = z.infer<
  typeof clinicSummaryShareDataSchema
>;

/**
 * Response schema of the share-create endpoint — wire-identical to
 * {@link clinicSummaryShareDataSchema}. Replaces the former response class
 * `ClinicSummaryShareResponseDto` (which extended
 * `ClinicSummaryShareDataDto` without adding fields).
 */
export const clinicSummaryShareResponseSchema = clinicSummaryShareDataSchema;

/** Strongly typed clinic-summary share response body. */
export type ClinicSummaryShareResponseDto = z.infer<
  typeof clinicSummaryShareResponseSchema
>;
