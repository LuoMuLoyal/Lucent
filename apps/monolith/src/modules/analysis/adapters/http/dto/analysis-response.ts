import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one bullet point of a Today analysis.
 * Replaces the former `AnalysisBulletDto` response class.
 */
export const analysisBulletSchema = z.object({
  kind: z.enum(['medication', 'hydration', 'sleep', 'general']),
  text: z.string(),
});

/** Strongly typed Today-analysis bullet point. */
export type AnalysisBulletDto = z.infer<typeof analysisBulletSchema>;

/**
 * Standard Schema (zod 4) for the observed-metric block attached to a Today
 * analysis. Replaces the former `AnalysisObservedMetricDto` response
 * class.
 */
export const analysisObservedMetricSchema = z.object({
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
export type AnalysisObservedMetricDto = z.infer<
  typeof analysisObservedMetricSchema
>;

/**
 * Standard Schema (zod 4) for one metric of a Today analysis. Replaces the
 * former `AnalysisMetricDto` response class.
 */
export const analysisMetricSchema = z.object({
  kind: z.enum(['medication', 'water', 'sleep']),
  observedMetric: analysisObservedMetricSchema,
});

/** Strongly typed Today-analysis metric entry. */
export type AnalysisMetricDto = z.infer<typeof analysisMetricSchema>;

/**
 * Standard Schema (zod 4) for a generated Today AI analysis resource.
 * Replaces the former `AnalysisDataDto` response class.
 */
export const analysisDataSchema = z.object({
  date: z.string(),
  generatedAt: z.string(),
  sourceVersion: z.number().optional(),
  summary: z.string(),
  bullets: z.array(analysisBulletSchema),
  actionLabel: z.string(),
  action: z.string(),
  confidenceNote: z.string(),
  briefingGenerated: z.boolean(),
  metrics: z.array(analysisMetricSchema).optional(),
});

/** Strongly typed generated Today AI analysis resource. */
export type AnalysisDataDto = z.infer<typeof analysisDataSchema>;

/**
 * Standard Schema (zod 4) for the persisted analysis read state. Replaces the
 * former `AnalysisReadDataDto` response class.
 */
export const analysisReadDataSchema = z.object({
  analysis: analysisDataSchema.nullable(),
  status: z.enum(['empty', 'pending', 'ready', 'stale', 'failed']),
  sourceVersion: z.number(),
  computedVersion: z.number(),
  computedAt: z.string().nullable(),
  retryAfterSeconds: z.number().nullable(),
});

/** Strongly typed persisted Today-analysis read state. */
export type AnalysisReadDataDto = z.infer<typeof analysisReadDataSchema>;

/**
 * Backwards-compatible response alias for `GET /analysis`; identical to
 * {@link AnalysisReadDataDto} on the wire.
 */
export type AnalysisReadResponseDto = AnalysisReadDataDto;

/**
 * Standard Schema (zod 4) for the enqueued-refresh outcome. Replaces the
 * former `AnalysisRefreshPendingDataDto` response class.
 */
export const analysisRefreshPendingDataSchema = z.object({
  status: z.literal('pending'),
  jobId: z.string(),
});

/** Strongly typed enqueued-refresh outcome. */
export type AnalysisRefreshPendingDataDto = z.infer<
  typeof analysisRefreshPendingDataSchema
>;

/**
 * Standard Schema (zod 4) for the synchronous-refresh outcome. Replaces the
 * former `AnalysisRefreshReadyDataDto` response class.
 */
export const analysisRefreshReadyDataSchema = z.object({
  status: z.literal('ready'),
  analysis: analysisDataSchema,
});

/** Strongly typed synchronous-refresh outcome. */
export type AnalysisRefreshReadyDataDto = z.infer<
  typeof analysisRefreshReadyDataSchema
>;

/**
 * Standard Schema (zod 4) for the async job acknowledgement. Replaces the
 * former `AnalysisAsyncJobDataDto` response class.
 */
export const analysisAsyncJobDataSchema = z.object({
  jobId: z.string(),
});

/** Strongly typed async job acknowledgement. */
export type AnalysisAsyncJobDataDto = z.infer<
  typeof analysisAsyncJobDataSchema
>;

/**
 * Standard Schema (zod 4) for the synchronous async-endpoint result. Replaces
 * the former `AnalysisAsyncResultDataDto` response class.
 */
export const analysisAsyncResultDataSchema = z.object({
  result: z.union([analysisDataSchema, analysisReadDataSchema]),
});

/** Strongly typed synchronous async-endpoint result. */
export type AnalysisAsyncResultDataDto = z.infer<
  typeof analysisAsyncResultDataSchema
>;

/**
 * Standard Schema (zod 4) for the async job status payload. Replaces the
 * former `AnalysisAsyncStatusDataDto` response class.
 */
export const analysisAsyncStatusDataSchema = z.object({
  status: z
    .enum(['empty', 'pending', 'ready', 'stale', 'failed'])
    .meta({ example: 'pending' }),
});

/** Strongly typed async job status payload. */
export type AnalysisAsyncStatusDataDto = z.infer<
  typeof analysisAsyncStatusDataSchema
>;
