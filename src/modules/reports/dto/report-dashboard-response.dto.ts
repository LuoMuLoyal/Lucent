import { z } from 'zod';
import { REPORT_SUPPORTED_RANGES } from './report-dashboard-query.dto.js';

/**
 * Report dashboard response schemas.
 *
 * Each schema replaces the former `@ApiProperty` response class of the same
 * name (minus the `Schema` suffix). Metric/trend items that carry a legacy
 * flat `value`/`status` surface keep those fields for backward compatibility;
 * the source-backed `observedMetric` block is the primary read model.
 */

/** Replaces `ReportObservedMetricDto`. */
export const reportObservedMetricSchema = z.object({
  value: z.number().nullable(),
  state: z
    .enum(['observed', 'unknown'])
    .describe(
      'Whether at least one observation exists. See coverage for the proportion of observed vs expected days.',
    ),
  coverage: z.enum(['sufficient', 'partial', 'none']),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z.number(),
  expectedCount: z.number().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
});

/** Strongly typed observed-metric block of a dashboard item. */
export type ReportObservedMetricDto = z.infer<
  typeof reportObservedMetricSchema
>;

/** Replaces `ReportMetricDto`. */
export const reportMetricSchema = z.object({
  kind: z.enum(['medication', 'water', 'sleep']),
  value: z.string(),
  unit: z.string(),
  status: z.enum(['good', 'stable', 'needs_attention', 'insufficient_data']),
  delta: z.string(),
  direction: z.enum(['up', 'down', 'flat']),
  sparkline: z.array(z.number()),
  observedMetric: reportObservedMetricSchema.optional(),
});

/** Strongly typed metric item of the report dashboard. */
export type ReportMetricDto = z.infer<typeof reportMetricSchema>;

/** Replaces `ReportTrendDto`. */
export const reportTrendSchema = z.object({
  kind: z.enum(['medication', 'water', 'sleep']),
  unit: z.string(),
  currentValue: z.string(),
  values: z
    .array(z.number())
    .describe(
      'Observed values only — unknown days are omitted, not zero-filled. ' +
        'BREAKING (since 2026-08-29): values.length no longer matches the date window length; ' +
        'use observedMetric.observedCount/expectedCount to align dates.',
    ),
  observedMetric: reportObservedMetricSchema.optional(),
});

/** Strongly typed trend item of the report dashboard. */
export type ReportTrendDto = z.infer<typeof reportTrendSchema>;

/** Replaces `ReportFindingDto`. */
export const reportFindingSchema = z.object({
  kind: z.enum(['medication', 'hydration', 'sleep', 'general']),
  title: z.string(),
  body: z.string(),
});

/** Strongly typed finding of the report dashboard. */
export type ReportFindingDto = z.infer<typeof reportFindingSchema>;

/** Replaces `ReportPatternDto`. */
export const reportPatternSchema = z.object({
  kind: z.enum(['medication', 'hydration', 'sleep', 'general']),
  title: z.string(),
  status: z.enum(['good', 'stable', 'needs_attention', 'insufficient_data']),
  body: z.string(),
  sparkline: z.array(z.number()),
});

/** Strongly typed pattern of the report dashboard. */
export type ReportPatternDto = z.infer<typeof reportPatternSchema>;

/**
 * The shared dashboard data shape. Replaces the former `@ApiProperty`
 * response class `ReportDashboardDataDto`.
 */
export const reportDashboardDataSchema = z.object({
  range: z.enum(REPORT_SUPPORTED_RANGES),
  startDate: z.string(),
  endDate: z.string(),
  generatedAt: z.string(),
  metrics: z.array(reportMetricSchema),
  trends: z.array(reportTrendSchema),
  findings: z.array(reportFindingSchema),
  patterns: z.array(reportPatternSchema),
  aiSummaryEnabled: z.boolean(),
});

/** Strongly typed report dashboard data payload. */
export type ReportDashboardDataDto = z.infer<typeof reportDashboardDataSchema>;

/**
 * Response schema of `GET /reports/dashboard` — wire-identical to
 * {@link reportDashboardDataSchema}. Replaces the former response class
 * `ReportDashboardResponseDto` (which extended `ReportDashboardDataDto`
 * without adding fields).
 */
export const reportDashboardResponseSchema = reportDashboardDataSchema;

/** Strongly typed report dashboard response body. */
export type ReportDashboardResponseDto = z.infer<
  typeof reportDashboardResponseSchema
>;
