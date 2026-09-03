import type { z } from 'zod';

import {
  dailyRecordListDataSchema,
  dailyRecordSummaryDataSchema,
} from './record-data.dto.js';
import { dailyRecordItemSchema } from './record-item.dto.js';

/**
 * Standard Schema (zod 4) for `GET /daily-records` (200).
 *
 * Replaces the former response class `DailyRecordListResponseDto` (which
 * extended `DailyRecordListDataDto` without adding fields).
 */
export const dailyRecordListResponseSchema = dailyRecordListDataSchema;

/** Strongly typed response body of `GET /daily-records`. */
export type DailyRecordListResponseDto = z.infer<
  typeof dailyRecordListResponseSchema
>;

/**
 * Standard Schema (zod 4) for `GET /daily-records/summary` (200).
 *
 * Replaces the former response class `DailyRecordSummaryResponseDto` (which
 * extended `DailyRecordSummaryDataDto` without adding fields).
 */
export const dailyRecordSummaryResponseSchema = dailyRecordSummaryDataSchema;

/** Strongly typed response body of `GET /daily-records/summary`. */
export type DailyRecordSummaryResponseDto = z.infer<
  typeof dailyRecordSummaryResponseSchema
>;

/**
 * Standard Schema (zod 4) for the single-record responses
 * (`GET/POST/PATCH /daily-records`).
 *
 * Replaces the former response class `DailyRecordResponseDto` (which extended
 * `DailyRecordItemDto` without adding fields).
 */
export const dailyRecordResponseSchema = dailyRecordItemSchema;

/** Strongly typed single-record response body of the record endpoints. */
export type DailyRecordResponseDto = z.infer<typeof dailyRecordResponseSchema>;
