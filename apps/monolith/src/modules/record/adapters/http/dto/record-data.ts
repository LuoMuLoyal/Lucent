import { z } from 'zod';

import { dailyRecordItemSchema } from './record-item.js';
import { dailyRecordSummarySchema } from './record-summary.js';

/**
 * Standard Schema (zod 4) for the `GET /record` list payload.
 *
 * Replaces the former `@ApiProperty` data class `RecordEntryListDataDto`.
 */
export const dailyRecordListDataSchema = z.object({
  items: z.array(dailyRecordItemSchema),
  total: z
    .number()
    .int()
    .describe('Total records for the date (before pagination).'),
});

/** Strongly typed daily-record list payload of `GET /record`. */
export type RecordEntryListDataDto = z.infer<typeof dailyRecordListDataSchema>;

/**
 * Standard Schema (zod 4) for the `GET /record/summary` payload.
 *
 * Replaces the former `@ApiProperty` data class `RecordEntrySummaryDataDto`.
 */
export const dailyRecordSummaryDataSchema = z.object({
  summaries: z.array(dailyRecordSummarySchema),
});

/** Strongly typed per-kind summary payload of `GET /record/summary`. */
export type RecordEntrySummaryDataDto = z.infer<
  typeof dailyRecordSummaryDataSchema
>;
