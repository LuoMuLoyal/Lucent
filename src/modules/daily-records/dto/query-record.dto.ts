import { z } from 'zod';

import { DailyRecordKind } from '#generated/prisma/client.js';

const DAILY_RECORD_KIND_VALUES = Object.values(DailyRecordKind) as [
  DailyRecordKind,
  ...DailyRecordKind[],
];

/**
 * Standard Schema (zod 4) for `GET /daily-records` query parameters.
 *
 * Replaces the former class-validator `QueryDailyRecordDto`:
 * - `@Type(() => Number)` + `@IsInt`/`@Min`/`@Max` → `z.coerce.number()`
 *   (query values arrive as strings; numeric strings are coerced, malformed
 *   ones fail);
 * - `@IsDateString` (YYYY-MM-DD docs) → `z.iso.date()`;
 * - `@IsEnum(DailyRecordKind)` → `z.enum(Object.values(...))`;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`
 *   (unknown query keys are rejected).
 */
export const queryDailyRecordSchema = z
  .object({
    date: z.iso.date().describe('Date in YYYY-MM-DD format.'),
    kind: z.enum(DAILY_RECORD_KIND_VALUES).optional(),
    page: z.coerce
      .number({ message: 'page must be a number' })
      .int('page must be an integer')
      .min(1, 'page must be at least 1')
      .describe('Page number (1-based).')
      .optional(),
    pageSize: z.coerce
      .number({ message: 'pageSize must be a number' })
      .int('pageSize must be an integer')
      .min(1, 'pageSize must be between 1 and 100')
      .max(100, 'pageSize must be between 1 and 100')
      .describe('Page size (1-100).')
      .optional(),
  })
  .strict();

/** Strongly typed query object of `GET /daily-records`. */
export type QueryDailyRecordDto = z.infer<typeof queryDailyRecordSchema>;
