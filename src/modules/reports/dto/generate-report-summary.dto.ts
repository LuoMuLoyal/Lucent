import { z } from 'zod';
import {
  refineReportRangeDates,
  REPORT_SUPPORTED_RANGES,
} from './report-dashboard-query.dto.js';

/**
 * Report-summary request body fields. Same shape and custom-range rule as
 * the dashboard query, but shipped over JSON: `range` is optional (the
 * service falls back to the default `last_7_days` scope) and a `custom`
 * range requires both ISO `startDate`/`endDate` values.
 */
const generateReportSummaryFields = z
  .object({
    range: z
      .enum(REPORT_SUPPORTED_RANGES)
      .describe('Supported report summary aggregation range.')
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

/**
 * Standard Schema (zod 4) for the `POST /reports/summary/generate*` bodies.
 *
 * The former class-validator pipe instantiated the DTO class, so a POST with
 * no payload arrived as an empty object (empty scope). Nest hands an absent
 * JSON body to the standard-schema pipe as `undefined`, so the object schema
 * carries `.default({})` — the empty scope stays valid and the OpenAPI
 * converter still renders the object shape (a `z.pipe(unknown → {})` wrapper
 * would make the body schema opaque to the converter).
 */
export const generateReportSummarySchema = generateReportSummaryFields.default(
  {},
);

/** Strongly typed body of `POST /reports/summary/generate*`. */
export type GenerateReportSummaryDto = z.infer<
  typeof generateReportSummarySchema
>;
