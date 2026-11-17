import { z } from 'zod';
import { dateOnlySchema } from '../../../../../common/validators/iso-datetime.schema.js';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordAttachmentInputSchema } from './record-attachment.js';

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
    kind: z
      .enum(DAILY_RECORD_KIND_VALUES)
      .meta({ example: 'vital' })
      .optional(),
    occurredAt: dateOnlySchema()
      .describe('Date in YYYY-MM-DD format.')
      .meta({ example: '2026-06-04' })
      .optional(),
    occurredTime: z
      .string()
      .regex(TIME_24H_PATTERN)
      .describe('Time in HH:mm 24-hour format. Use null to clear.')
      .meta({ example: '08:30' })
      .nullish(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('Short label. Use null to clear.')
      .meta({ example: 'Morning blood pressure' })
      .nullish(),
    value: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Measured value. Use null to clear.')
      .meta({ example: '120/80' })
      .nullish(),
    unit: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .describe('Unit label. Use null to clear.')
      .meta({ example: 'mmHg' })
      .nullish(),
    note: z
      .string()
      .max(1000)
      .describe('Free-text note. Use null to clear.')
      .meta({ example: 'After waking up.' })
      .nullish(),
    payload: z
      .record(z.string(), z.unknown())
      .describe(
        'Structured payload for kind-specific data. Sleep accepts sleepType (nightSleep|nap), startedAt, endedAt, durationMinutes and optional quality. endedAt must be later than startedAt. Meal accepts only the dish list { mealAnalysis: { dishes: [{ name: string }] } }: the analysis itself is server-owned, and sending attachments with exactly one image re-runs the analysis.',
      )
      .meta({
        example: {
          sleepType: 'nightSleep',
          startedAt: '2026-06-03T23:15:00.000Z',
          endedAt: '2026-06-04T06:45:00.000Z',
          durationMinutes: 450,
        },
      })
      .nullish(),
    healthEventId: z
      .uuid()
      .describe('Active health event association. Use null to clear.')
      .meta({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
      .nullish(),
    attachments: z
      .array(dailyRecordAttachmentInputSchema)
      .describe(
        'Replacement attachment metadata list. Omit to keep existing attachments; send [] to clear.',
      )
      .meta({
        example: [
          {
            kind: 'image',
            objectKey: 'daily-records/user_1/2026-06-04/photo.jpg',
            contentType: 'image/jpeg',
          },
        ],
      })
      .optional(),
  })
  .strict();

/** Strongly typed update body of `PATCH /daily-records/:id`. */
export type UpdateDailyRecordDto = z.infer<typeof updateDailyRecordSchema>;
