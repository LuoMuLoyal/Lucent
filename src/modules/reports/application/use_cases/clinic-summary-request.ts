import { z } from 'zod';
import { ClinicSummaryShareField } from '#generated/prisma/client.js';

/**
 * Maximum span of a date-range clinic-summary scope, in INCLUSIVE calendar
 * days (dateFrom..dateTo both counted). Mirrors the product's largest
 * supported report range (`REPORT_RANGE_LAST_30_DAYS` in
 * report-dashboard-query.dto.ts): the legacy summary default
 * `last_30_days` never exceeded 30 days, so custom date ranges stay within
 * the same safety cap. Enforced at scope-resolution time in
 * `ClinicSummaryService` (which both the controller and the share-store
 * validation converge on).
 */
export const CLINIC_SUMMARY_MAX_RANGE_DAYS = 30;

/** Allowed `selectedFields` values — the fixed share-field enum verbatim. */
export const CLINIC_SUMMARY_SELECTABLE_FIELDS: string[] = Object.values(
  ClinicSummaryShareField,
);

/**
 * Date-range scope rule. Mirrors the former class-validator
 * `@ValidateIf((o) => o.eventId == null && (o.dateFrom != null || o.dateTo != null))`
 * + `@IsDefined`/`@IsDateString` decorators: a partial date pair is rejected
 * only when no `eventId` wins the scope — otherwise the pair is ignored and
 * event scope applies (legacy behaviour).
 */
function refineClinicSummaryScope(
  dto: {
    eventId?: string | undefined;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (dto.eventId != null || (dto.dateFrom == null && dto.dateTo == null)) {
    return;
  }
  for (const key of ['dateFrom', 'dateTo'] as const) {
    const value = dto[key];
    if (value == null || value === '') {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when a date range is given.`,
      });
    } else if (!z.iso.date().safeParse(value).success) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} must be a valid ISO 8601 date (YYYY-MM-DD).`,
      });
    }
  }
}

/**
 * Clinic Summary request scope: `eventId` or a complete `dateFrom`/`dateTo`
 * pair, or neither (an empty scope falls back to the default `last_30_days`
 * range — legacy semantics). Event scope wins when both are supplied (the
 * share-record layer in ShareService stays strict XOR at the persistence
 * boundary; the controller forwards only the winning scope, materializing
 * the default range when no scope is given).
 *
 * Date-range semantics: the window covers `dateFrom`..`dateTo` INCLUSIVE
 * (both calendar days included); the response `end` is the exclusive upper
 * bound (dateTo + 1 day). The span is capped at
 * {@link CLINIC_SUMMARY_MAX_RANGE_DAYS} inclusive calendar days.
 *
 * Known limitation (content-window binding is a later task): findings and
 * coverage are bound to the current/relevant event review (or the fixed
 * 资料不足 statement when no review exists) and do NOT yet honor the custom
 * date window — the window only shapes scopeLabel/start/end.
 *
 * The former class-validator pipe instantiated the DTO class, so a POST with
 * no payload arrived as an empty object (empty scope). Nest hands an absent
 * JSON body to the standard-schema pipe as `undefined`; the schema's
 * `.default({})` keeps the empty-body request valid (see schema export).
 */
const clinicSummaryRequestFields = z
  .object({
    eventId: z
      .string()
      .describe(
        'Event scope: build the summary from this event review. Wins over ' +
          'dateFrom/dateTo when both are supplied.',
      )
      .optional(),
    dateFrom: z
      .string()
      .describe(
        'Date-range scope start (ISO 8601 date, YYYY-MM-DD). Both dates are ' +
          'required whenever a date range is given (a partial pair is ' +
          'rejected); ignored when eventId is present. When neither eventId ' +
          'nor a date range is supplied, the summary falls back to the ' +
          'default last_30_days range (legacy semantics).',
      )
      .optional(),
    dateTo: z
      .string()
      .describe(
        'Date-range scope end (ISO 8601 date, YYYY-MM-DD). Inclusive calendar ' +
          'day; both dates required whenever a date range is given; span must ' +
          `cover at most ${String(CLINIC_SUMMARY_MAX_RANGE_DAYS)} inclusive ` +
          'calendar days. When neither eventId nor a date range is supplied, ' +
          'the summary falls back to the default last_30_days range (legacy ' +
          'semantics).',
      )
      .optional(),
    selectedFields: z
      .array(z.enum(CLINIC_SUMMARY_SELECTABLE_FIELDS as [string, ...string[]]))
      .min(1)
      .max(CLINIC_SUMMARY_SELECTABLE_FIELDS.length)
      .describe(
        'Summary sections to include. Empty arrays and unknown values are ' +
          'rejected; when omitted every section is included.',
      )
      .optional(),
  })
  .strict()
  .superRefine(refineClinicSummaryScope);

/**
 * Standard Schema (zod 4) for the `POST /reports/clinic-summary/*` bodies
 * (preview / share / export async / preview PDF).
 *
 * Replaces the former class-validator DTO; the global `forbidNonWhitelisted`
 * behaviour is preserved with `.strict()` (unknown body keys are rejected).
 * The absent-body normalisation from the legacy pipe (empty object) is kept
 * via `.default({})` — a `z.pipe(unknown → {})` wrapper would turn the body
 * schema opaque to the OpenAPI converter.
 */
export const clinicSummaryRequestSchema = clinicSummaryRequestFields.default(
  {},
);

/** Strongly typed body of the clinic-summary request endpoints. */
export type ClinicSummaryRequestDto = z.infer<
  typeof clinicSummaryRequestSchema
>;
