import { z } from 'zod';

export const REPORT_RANGE_LAST_7_DAYS = 'last_7_days';
export const REPORT_RANGE_LAST_30_DAYS = 'last_30_days';
export const REPORT_RANGE_CUSTOM = 'custom';
export const REPORT_SUPPORTED_RANGES = [
  REPORT_RANGE_LAST_7_DAYS,
  REPORT_RANGE_LAST_30_DAYS,
  REPORT_RANGE_CUSTOM,
] as const;

export type ReportRange = (typeof REPORT_SUPPORTED_RANGES)[number];

/**
 * Custom-range date-pair rule. Mirrors the former class-validator
 * `@ValidateIf((o) => o.range === REPORT_RANGE_CUSTOM)` + `@IsDateString`
 * decorators: only when `range` is `custom` must `startDate` and `endDate`
 * be present and be valid `YYYY-MM-DD` calendar dates. Outside a custom
 * range the date fields are never consumed, so stray or malformed values
 * are still tolerated — legacy behaviour.
 */
export function refineReportRangeDates(
  scope: {
    range?: ReportRange | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (scope.range !== REPORT_RANGE_CUSTOM) {
    return;
  }
  if (scope.startDate == null || scope.startDate === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['startDate'],
      message: 'startDate is required when range is custom.',
    });
  } else if (!z.iso.date().safeParse(scope.startDate).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['startDate'],
      message: 'startDate must be a valid ISO 8601 date (YYYY-MM-DD).',
    });
  }
  if (scope.endDate == null || scope.endDate === '') {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate is required when range is custom.',
    });
  } else if (!z.iso.date().safeParse(scope.endDate).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be a valid ISO 8601 date (YYYY-MM-DD).',
    });
  }
}

/**
 * Standard Schema (zod 4) for `GET /reports/dashboard` query parameters.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsIn(REPORT_SUPPORTED_RANGES)` → `z.enum(REPORT_SUPPORTED_RANGES)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown query keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 *
 * An omitted `range` stays `undefined`: the service layer applies the
 * `last_7_days` default (dashboard.service / context.service), which keeps
 * the parsed shape optional for internal callers that build the query
 * programmatically.
 */
export const reportDashboardQuerySchema = z
  .object({
    range: z
      .enum(REPORT_SUPPORTED_RANGES)
      .describe('Supported report aggregation range.')
      .optional(),
    startDate: z
      .string()
      .describe(
        'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
      )
      .optional(),
    endDate: z
      .string()
      .describe(
        'Required when range is "custom". ISO 8601 date string (YYYY-MM-DD).',
      )
      .optional(),
  })
  .strict()
  .superRefine(refineReportRangeDates);

/** Strongly typed query object of `GET /reports/dashboard`. */
export type ReportDashboardQueryDto = z.infer<
  typeof reportDashboardQuerySchema
>;
