import type { z } from 'zod';

import {
  dailyRecordListDataSchema,
  dailyRecordSummaryDataSchema,
} from './record-data.js';
import { dailyRecordItemSchema } from './record-item.js';

/**
 * Standard Schema (zod 4) for `GET /record` (200).
 *
 * Replaces the former response class `RecordEntryListResponseDto` (which
 * extended `RecordEntryListDataDto` without adding fields).
 */
export const dailyRecordListResponseSchema = dailyRecordListDataSchema;

/** Strongly typed response body of `GET /record`. */
export type RecordEntryListResponseDto = z.infer<
  typeof dailyRecordListResponseSchema
>;

/**
 * Standard Schema (zod 4) for `GET /record/summary` (200).
 *
 * Replaces the former response class `RecordEntrySummaryResponseDto` (which
 * extended `RecordEntrySummaryDataDto` without adding fields).
 */
export const dailyRecordSummaryResponseSchema = dailyRecordSummaryDataSchema;

/** Strongly typed response body of `GET /record/summary`. */
export type RecordEntrySummaryResponseDto = z.infer<
  typeof dailyRecordSummaryResponseSchema
>;

/**
 * Standard Schema (zod 4) for the single-record responses
 * (`GET/POST/PATCH /record`).
 *
 * Replaces the former response class `RecordEntryResponseDto` (which extended
 * `RecordEntryItemDto` without adding fields).
 */
export const dailyRecordResponseSchema = dailyRecordItemSchema;

/** Strongly typed single-record response body of the record endpoints. */
export type RecordEntryResponseDto = z.infer<typeof dailyRecordResponseSchema>;
