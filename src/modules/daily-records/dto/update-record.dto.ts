import { z } from 'zod';
import { dateOnlySchema } from '../../../common/validators/iso-datetime.schema.js';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordAttachmentInputSchema } from './record-attachment.dto.js';

const DAILY_RECORD_KIND_VALUES = Object.values(DailyRecordKind) as [
  DailyRecordKind,
  ...DailyRecordKind[],
];

const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Standard Schema (zod 4) for `PATCH /daily-records/:id` (update body).
 *
 * Replaces the former class-validator `UpdateDailyRecordDto`; same mapping
 * as `createDailyRecordSchema`, plus:
 * - every mutable field is `.nullish()` when the API contract allows an
 *   explicit `null` to clear the stored value (`@ApiPropertyOptional
 *   nullable: true`, `@IsOptional` previously skipped `null`);
 * - `occurredAt` stays date-only and non-nullable (a record always has a
 *   date — `null` draft values are skipped by callers, see
 *   assistant/core.service).
 */
export const updateDailyRecordSchema = z
  .object({
    kind: z.enum(DAILY_RECORD_KIND_VALUES).optional(),
    occurredAt: dateOnlySchema()
      .describe('Date in YYYY-MM-DD format.')
      .optional(),
    occurredTime: z
      .string()
      .regex(TIME_24H_PATTERN)
      .describe('Time in HH:mm 24-hour format. Use null to clear.')
      .nullish(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Short label. Use null to clear.')
      .nullish(),
    value: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Measured value. Use null to clear.')
      .nullish(),
    unit: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .describe('Unit label. Use null to clear.')
      .nullish(),
    note: z
      .string()
      .max(1000)
      .describe('Free-text note. Use null to clear.')
      .nullish(),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        'Structured payload for kind-specific data. Sleep accepts sleepType (nightSleep|nap), startedAt, endedAt, durationMinutes and optional quality; legacy startAt/endAt remain readable. endedAt must be later than startedAt.',
      )
      .nullish(),
    healthEventId: z
      .uuid()
      .describe('Active health event association. Use null to clear.')
      .nullish(),
    attachments: z
      .array(dailyRecordAttachmentInputSchema)
      .describe(
        'Replacement attachment metadata list. Omit to keep existing attachments; send [] to clear.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed update body of `PATCH /daily-records/:id`. */
export type UpdateDailyRecordDto = z.infer<typeof updateDailyRecordSchema>;
