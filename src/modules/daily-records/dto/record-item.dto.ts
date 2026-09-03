import { z } from 'zod';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordAttachmentSchema } from './record-attachment.dto.js';

/**
 * Standard Schema (zod 4) for one daily-record read item — the wire shape of
 * `GET/POST/PATCH /daily-records` responses.
 *
 * Replaces the former `@ApiProperty` response class `DailyRecordItemDto`. The
 * mapper always emits every key (nullable columns become an explicit `null`;
 * `mealTopFoods`/`attachments` default to empty arrays), so fields are
 * required and `.nullable()` marks null-capable columns only.
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
      'Structured payload for kind-specific data. For sleep: { startAt, endAt, durationMinutes, quality?, deepMinutes?, lightMinutes?, remMinutes? }. For vital: { vitalType, value, unit, secondaryValue?, secondaryUnit? }. For activity: { activityType, value, unit }.',
    )
    .nullable(),
  mealAnalysisStatus: z
    .string()
    .describe('Meal analysis status for meal records.')
    .nullable(),
  mealAnalysisCoverage: z
    .string()
    .describe('Meal analysis coverage for meal records.')
    .nullable(),
  mealAnalysisUpdatedAt: z
    .string()
    .describe('Meal analysis updated timestamp (ISO 8601).')
    .nullable(),
  mealAnalysisFailureReason: z
    .string()
    .describe('Display-safe meal analysis failure reason.')
    .nullable(),
  mealShortDescription: z
    .string()
    .describe('Short meal description for list reads.')
    .nullable(),
  mealTopFoods: z
    .array(z.string())
    .describe('Top recognized foods for list reads.'),
  attachments: z.array(dailyRecordAttachmentSchema),
  createdAt: z.string().describe('Created at (ISO 8601).'),
  updatedAt: z.string().describe('Updated at (ISO 8601).'),
});

/** Strongly typed daily-record read item returned by record endpoints. */
export type DailyRecordItemDto = z.infer<typeof dailyRecordItemSchema>;
