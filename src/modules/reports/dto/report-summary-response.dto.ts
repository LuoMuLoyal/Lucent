import { z } from 'zod';
import { REPORT_SUPPORTED_RANGES } from './report-dashboard-query.dto.js';

/**
 * AI report summary response schemas.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix).
 */

/** Replaces `ReportCoverageDimensionDto`. */
export const reportCoverageDimensionSchema = z.object({
  trackedDays: z.number(),
  totalDays: z.number(),
});

/** Strongly typed tracked/total day counts of one coverage dimension. */
export type ReportCoverageDimensionDto = z.infer<
  typeof reportCoverageDimensionSchema
>;

/** Replaces `ReportCoverageDto`. */
export const reportCoverageSchema = z.object({
  medication: reportCoverageDimensionSchema,
  water: reportCoverageDimensionSchema,
  sleep: reportCoverageDimensionSchema,
});

/** Strongly typed coverage block of the report summary. */
export type ReportCoverageDto = z.infer<typeof reportCoverageSchema>;

/** Replaces `ReportObservedPatternDto`. */
export const reportObservedPatternSchema = z.object({
  kind: z.enum(['medication', 'hydration', 'sleep']),
  text: z.string(),
  source: z.string(),
});

/** Strongly typed source-backed observed pattern of the report summary. */
export type ReportObservedPatternDto = z.infer<
  typeof reportObservedPatternSchema
>;

/** Replaces `ReportLowRiskActionDto`. */
export const reportLowRiskActionSchema = z.object({
  label: z.string(),
  text: z.string(),
});

/** Strongly typed low-risk action of the report summary. */
export type ReportLowRiskActionDto = z.infer<typeof reportLowRiskActionSchema>;

/**
 * The shared report summary data shape. Replaces the former `@ApiProperty`
 * response class `ReportSummaryDataDto`.
 */
export const reportSummaryDataSchema = z.object({
  range: z.enum(REPORT_SUPPORTED_RANGES),
  startDate: z.string(),
  endDate: z.string(),
  generatedAt: z.string(),
  summary: z.string(),
  coverage: reportCoverageSchema,
  observedPattern: reportObservedPatternSchema
    .nullable()
    .describe(
      'At most one source-backed observed pattern. Null when data is insufficient.',
    ),
  lowRiskAction: reportLowRiskActionSchema
    .nullable()
    .describe('At most one low-risk action. Null when no action is warranted.'),
  disclaimer: z.string(),
});

/** Strongly typed report summary data payload. */
export type ReportSummaryDataDto = z.infer<typeof reportSummaryDataSchema>;

/**
 * Response schema of `POST /reports/summary/generate` — wire-identical to
 * {@link reportSummaryDataSchema}. Replaces the former response class
 * `ReportSummaryResponseDto` (which extended `ReportSummaryDataDto` without
 * adding fields).
 */
export const reportSummaryResponseSchema = reportSummaryDataSchema;

/** Strongly typed synchronous report summary response body. */
export type ReportSummaryResponseDto = z.infer<
  typeof reportSummaryResponseSchema
>;

/**
 * Response schema of `POST /reports/summary/generate/async` — either a queued
 * `jobId` or the inline summary `result`. Replaces the former response class
 * `ReportSummaryAsyncResponseDto`.
 */
export const reportSummaryAsyncResponseSchema = z.object({
  jobId: z
    .string()
    .optional()
    .describe('Queued report summary job identifier.'),
  result: reportSummaryDataSchema
    .optional()
    .describe(
      'Inline report summary resource when queue processing is unavailable.',
    ),
});

/** Strongly typed async report summary response body. */
export type ReportSummaryAsyncResponseDto = z.infer<
  typeof reportSummaryAsyncResponseSchema
>;
