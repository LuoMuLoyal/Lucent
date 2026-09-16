import { z } from 'zod';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordAttachmentSchema } from './record-attachment.dto.js';

/**
 * Standard Schema (zod 4) for one daily-record read item — the wire shape of
 * `GET/POST/PATCH /daily-records` responses.
 *
 * Replaces the former `@ApiProperty` response class `DailyRecordItemDto`. The
 * mapper always emits every key (nullable columns become an explicit `null`),
 * so fields are required and `.nullable()` marks null-capable columns only.
 *
 * 餐食记录:分析结论**不进 item 的 payload**(列表读为 null),而是投影字段
 * `mealAnalysisStatus` / `mealHeadline` / `mealCalorieMin|Max|Bucket` /
 * `mealAnalysisFailureReason`;详情接口才返回完整 `payload.mealAnalysis`
 * (`items` 全量 + `dishes`)。
 */
export const dailyRecordItemSchema = z.object({
  id: z.string().describe('Record id.'),
  kind: z.enum(DailyRecordKind),
  healthEventId: z.string().describe('Linked health event id.').nullable(),
  occurredAt: z.string().describe('Date in YYYY-MM-DD format.'),
  occurredTime: z
    .string()
    .describe('Time in HH:mm 24-hour format when available.')
    .nullable(),
  title: z.string().describe('Short label.').nullable(),
  value: z.string().describe('Measured value.').nullable(),
  unit: z.string().describe('Unit label.').nullable(),
  note: z.string().describe('Free-text note.').nullable(),
  source: z.string().describe('Source.').nullable(),
  payload: z
    .record(z.string(), z.unknown())
    .describe(
      'Structured payload for kind-specific data. For sleep: { startedAt, endedAt, durationMinutes, sleepType?, quality?, deepMinutes?, lightMinutes?, remMinutes? }. For symptom: { symptom?: string, severity?: "mild"|"moderate"|"severe"|"unknown", customLabel?: string }. For vital: { vitalType, value, unit, secondaryValue?, secondaryUnit? }. For activity: { activityType, value, unit }. For meal (detail reads only): { mealAnalysis: { version, analysisStatus, analyzedAt, sourceRevision, model, promptVersion, locale, failureReason, calorieRange, dishes, items, facets } }.',
    )
    .nullable(),
  mealAnalysisStatus: z
    .string()
    .describe(
      'Meal analysis status: "analyzing", "analyzed", or "analysis_failed".',
    )
    .nullable(),
  mealAnalysisUpdatedAt: z
    .string()
    .describe('Meal analysis updated timestamp (ISO 8601).')
    .nullable(),
  mealAnalysisFailureReason: z
    .string()
    .describe(
      'Stable failure reason code (image_count_invalid, vision_unavailable, model_failed, model_timeout, job_lost, invalid_output).',
    )
    .nullable(),
  mealHeadline: z
    .string()
    .describe('Most important meal finding, for the list row.')
    .nullable(),
  mealCalorieMin: z
    .number()
    .describe('Estimated energy interval lower bound (kcal).')
    .nullable(),
  mealCalorieMax: z
    .number()
    .describe('Estimated energy interval upper bound (kcal).')
    .nullable(),
  mealCalorieBucket: z
    .enum(['low', 'medium', 'high'])
    .describe('Coarse energy bucket derived from the interval.')
    .nullable(),
  attachments: z.array(dailyRecordAttachmentSchema),
  createdAt: z.string().describe('Created at (ISO 8601).'),
  updatedAt: z.string().describe('Updated at (ISO 8601).'),
});

/** Strongly typed daily-record read item returned by record endpoints. */
export type DailyRecordItemDto = z.infer<typeof dailyRecordItemSchema>;
