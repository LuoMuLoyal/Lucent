import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one bullet point of a Today analysis.
 * Replaces the former `TodayAnalysisBulletDto` response class.
 */
export const todayAnalysisBulletSchema = z.object({
  kind: z.enum(['medication', 'hydration', 'sleep', 'general']),
  text: z.string(),
});

/** Strongly typed Today-analysis bullet point. */
export type TodayAnalysisBulletDto = z.infer<typeof todayAnalysisBulletSchema>;

/**
 * Standard Schema (zod 4) for the observed-metric block attached to a Today
 * analysis. Replaces the former `TodayAnalysisObservedMetricDto` response
 * class.
 */
export const todayAnalysisObservedMetricSchema = z.object({
  value: z.number().nullable(),
  state: z.enum(['observed', 'unknown']),
  coverage: z.enum(['sufficient', 'partial', 'none']),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z.number(),
  expectedCount: z.number().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
});

/** Strongly typed Today-analysis observed-metric block. */
export type TodayAnalysisObservedMetricDto = z.infer<
  typeof todayAnalysisObservedMetricSchema
>;

/**
 * Standard Schema (zod 4) for one metric of a Today analysis. Replaces the
 * former `TodayAnalysisMetricDto` response class.
 */
export const todayAnalysisMetricSchema = z.object({
  kind: z.enum(['medication', 'water', 'sleep']),
  observedMetric: todayAnalysisObservedMetricSchema,
});

/** Strongly typed Today-analysis metric entry. */
export type TodayAnalysisMetricDto = z.infer<typeof todayAnalysisMetricSchema>;

/**
 * Standard Schema (zod 4) for a generated Today AI analysis resource.
 * Replaces the former `TodayAnalysisDataDto` response class.
 */
export const todayAnalysisDataSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  sourceVersion: z.number().optional(),
  summary: z.string(),
  bullets: z.array(todayAnalysisBulletSchema),
  actionLabel: z.string(),
  action: z.string(),
  confidenceNote: z.string(),
  aiGenerated: z.boolean(),
  metrics: z.array(todayAnalysisMetricSchema).optional(),
});

/** Strongly typed generated Today AI analysis resource. */
export type TodayAnalysisDataDto = z.infer<typeof todayAnalysisDataSchema>;

/**
 * Standard Schema (zod 4) for the persisted analysis read state. Replaces the
 * former `TodayAnalysisReadDataDto` response class.
 */
export const todayAnalysisReadDataSchema = z.object({
  analysis: todayAnalysisDataSchema.nullable(),
  status: z.enum(['empty', 'pending', 'ready', 'stale', 'failed']),
  sourceVersion: z.number(),
  computedVersion: z.number(),
  computedAt: z.string().nullable(),
  retryAfterSeconds: z.number().nullable(),
});

/** Strongly typed persisted Today-analysis read state. */
export type TodayAnalysisReadDataDto = z.infer<
  typeof todayAnalysisReadDataSchema
>;

/**
 * Backwards-compatible response alias for `GET /today-analysis`; identical to
 * {@link TodayAnalysisReadDataDto} on the wire.
 */
export type TodayAnalysisReadResponseDto = TodayAnalysisReadDataDto;

/**
 * Standard Schema (zod 4) for the enqueued-refresh outcome. Replaces the
 * former `TodayAnalysisRefreshPendingDataDto` response class.
 */
export const todayAnalysisRefreshPendingDataSchema = z.object({
  status: z.literal('pending'),
  jobId: z.string(),
});

/** Strongly typed enqueued-refresh outcome. */
export type TodayAnalysisRefreshPendingDataDto = z.infer<
  typeof todayAnalysisRefreshPendingDataSchema
>;

/**
 * Standard Schema (zod 4) for the synchronous-refresh outcome. Replaces the
 * former `TodayAnalysisRefreshReadyDataDto` response class.
 */
export const todayAnalysisRefreshReadyDataSchema = z.object({
  status: z.literal('ready'),
  analysis: todayAnalysisDataSchema,
});

/** Strongly typed synchronous-refresh outcome. */
export type TodayAnalysisRefreshReadyDataDto = z.infer<
  typeof todayAnalysisRefreshReadyDataSchema
>;

/**
 * Standard Schema (zod 4) for the async job acknowledgement. Replaces the
 * former `TodayAnalysisAsyncJobDataDto` response class.
 */
export const todayAnalysisAsyncJobDataSchema = z.object({
  jobId: z.string(),
});

/** Strongly typed async job acknowledgement. */
export type TodayAnalysisAsyncJobDataDto = z.infer<
  typeof todayAnalysisAsyncJobDataSchema
>;

/**
 * Standard Schema (zod 4) for the synchronous async-endpoint result. Replaces
 * the former `TodayAnalysisAsyncResultDataDto` response class.
 */
export const todayAnalysisAsyncResultDataSchema = z.object({
  result: z.union([todayAnalysisDataSchema, todayAnalysisReadDataSchema]),
});

/** Strongly typed synchronous async-endpoint result. */
export type TodayAnalysisAsyncResultDataDto = z.infer<
  typeof todayAnalysisAsyncResultDataSchema
>;

/**
 * Standard Schema (zod 4) for the async job status payload. Replaces the
 * former `TodayAnalysisAsyncStatusDataDto` response class.
 */
export const todayAnalysisAsyncStatusDataSchema = z.object({
  status: z.enum(['empty', 'pending', 'ready', 'stale', 'failed']),
});

/** Strongly typed async job status payload. */
export type TodayAnalysisAsyncStatusDataDto = z.infer<
  typeof todayAnalysisAsyncStatusDataSchema
>;
