import { z } from 'zod';

import { dailyRecordItemSchema } from './record-item.dto.js';
import { dailyRecordSummarySchema } from './record-summary.dto.js';

/**
 * Standard Schema (zod 4) for the `GET /daily-records` list payload.
 *
 * Replaces the former `@ApiProperty` data class `DailyRecordListDataDto`.
 */
export const dailyRecordListDataSchema = z.object({
  items: z.array(dailyRecordItemSchema),
  total: z
    .number()
    .int()
    .describe('Total records for the date (before pagination).'),
});

/** Strongly typed daily-record list payload of `GET /daily-records`. */
export type DailyRecordListDataDto = z.infer<typeof dailyRecordListDataSchema>;

/**
 * Standard Schema (zod 4) for the `GET /daily-records/summary` payload.
 *
 * Replaces the former `@ApiProperty` data class `DailyRecordSummaryDataDto`.
 */
export const dailyRecordSummaryDataSchema = z.object({
  summaries: z.array(dailyRecordSummarySchema),
});

/** Strongly typed per-kind summary payload of `GET /daily-records/summary`. */
export type DailyRecordSummaryDataDto = z.infer<
  typeof dailyRecordSummaryDataSchema
>;
