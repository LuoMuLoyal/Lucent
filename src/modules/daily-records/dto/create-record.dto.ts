import { z } from 'zod';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordAttachmentInputSchema } from './record-attachment.dto.js';

const DAILY_RECORD_KIND_VALUES = Object.values(DailyRecordKind) as [
  DailyRecordKind,
  ...DailyRecordKind[],
];

const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Standard Schema (zod 4) for `POST /daily-records` (create body).
 *
 * Replaces the former class-validator `CreateDailyRecordDto`:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsNotEmpty` text fields → `.trim().min(1)` (whitespace-only is
 *   rejected and surrounding whitespace is normalised, matching what the
 *   mapper's `normalizeNullableText` stored before);
 * - `@IsDateString` (YYYY-MM-DD docs) → `z.iso.date()` (calendar-valid
 *   date-only strings);
 * - `@Matches` time pattern → `z.string().regex(...)`;
 * - `@IsEnum(DailyRecordKind)` → `z.enum(Object.values(...))`;
 * - `@IsUUID` → `z.uuid()`, nullable via `.nullish()`;
 * - `@IsObject` payload → `z.record(z.string(), z.unknown())` (rejects
 *   arrays/null, keeps nested payload keys free-form);
 * - `@ValidateNested({ each: true })` attachments → nested
 *   `dailyRecordAttachmentInputSchema` array;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const createDailyRecordSchema = z
  .object({
    kind: z.enum(DAILY_RECORD_KIND_VALUES),
    occurredAt: z.iso
      .date()
      .describe(
        'Date in YYYY-MM-DD format. For sleep records this is the wake date (the morning the user wakes up from that sleep).',
      ),
    occurredTime: z
      .string()
      .regex(TIME_24H_PATTERN)
      .describe(
        'Time in HH:mm 24-hour format. When omitted, UI flows may treat the record as date-only.',
      )
      .optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Short label.')
      .optional(),
    value: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Measured value.')
      .optional(),
    unit: z.string().trim().min(1).max(50).describe('Unit label.').optional(),
    note: z.string().max(1000).describe('Free-text note.').optional(),
    source: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .describe(
        'Record source. Defaults to "manual". Use "apple_health" or "health_connect" for auto-synced records.',
      )
      .optional(),
    healthEventId: z
      .uuid()
      .describe('Optional active health event association.')
      .nullish(),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        'Structured payload for kind-specific data. For sleep: { sleepType?: "nightSleep"|"nap", startedAt?: string, endedAt?: string, durationMinutes, quality? }. Legacy startAt/endAt remain readable and map to nightSleep. endedAt must be later than startedAt; cross-midnight intervals are valid. For vital: { vitalType: "heartRate"|"bloodPressure"|"bloodOxygen"|"bloodGlucose"|"bodyTemperature"|"weight"|"respiratoryRate", value: number, unit: string, secondaryValue?: number, secondaryUnit?: string }. For activity: { activityType: "steps"|"flightsClimbed"|"distance"|"exerciseTime", value: number, unit: string }. Vital and activity payloads are optional for manual entry.',
      )
      .optional(),
    attachments: z
      .array(dailyRecordAttachmentInputSchema)
      .describe(
        'Attachment metadata. File upload itself is handled separately.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed create body of `POST /daily-records`. */
export type CreateDailyRecordDto = z.infer<typeof createDailyRecordSchema>;
