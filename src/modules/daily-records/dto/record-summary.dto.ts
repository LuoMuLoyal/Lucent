import { z } from 'zod';

import { DailyRecordKind } from '#generated/prisma/client.js';
import { dailyRecordItemSchema } from './record-item.dto.js';

/**
 * Standard Schema (zod 4) for one entry of the per-kind daily-record summary
 * (`GET /daily-records/summary`).
 *
 * Replaces the former `@ApiProperty` response class `DailyRecordSummaryDto`.
 * The mapper always emits `latest` (the most recent record of the kind, or
 * `null` when the kind has no record), so it is a required nullable field.
 */
export const dailyRecordSummarySchema = z.object({
  kind: z.enum(DailyRecordKind),
  count: z
    .number()
    .int()
    .describe('Count of records for this kind on the given date.'),
  latest: dailyRecordItemSchema
    .describe('Most recent record of this kind.')
    .nullable(),
});

/** Strongly typed per-kind daily-record summary of the summary endpoint. */
export type DailyRecordSummaryDto = z.infer<typeof dailyRecordSummarySchema>;
