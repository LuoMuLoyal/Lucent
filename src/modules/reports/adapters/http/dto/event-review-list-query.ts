import { z } from 'zod';
import { HealthEventStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for the `GET /reports/reviews` query parameters.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsEnum(HealthEventStatus)` → `z.enum(HealthEventStatus)` (zod 4 merges
 *   native-enum handling into `z.enum`; Prisma exports the enum as a const
 *   object whose values equal its keys);
 * - `@Type(() => Number)` + `@IsInt` + `@Min(1)` + `@Max(100)` →
 *   `z.coerce.number().int().min(1).max(100)` (query values arrive as
 *   strings; numeric strings are coerced, malformed ones fail);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown query keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 *
 * A malformed composite `cursor` passes the DTO (plain string) and is
 * rejected by `EventReviewService.resolveCursor` with VALIDATION_FAILED —
 * same split as before.
 */
export const eventReviewListQuerySchema = z
  .object({
    status: z
      .enum(HealthEventStatus)
      .describe('Filter events by status. No time range is required.')
      .optional(),
    cursor: z
      .string()
      .describe(
        'Opaque cursor for pagination: composite of the last item startedAt ' +
          'ISO 8601 value and id joined with "|", as returned by nextCursor. ' +
          'Must not be constructed by the client.',
      )
      .optional(),
    limit: z.coerce
      .number({ message: 'limit must be a number' })
      .int({ message: 'limit must be an integer' })
      .min(1, 'limit must be between 1 and 100')
      .max(100, 'limit must be between 1 and 100')
      .describe('Page size (1-100).')
      .optional(),
  })
  .strict();

/** Strongly typed query object of `GET /reports/reviews`. */
export type EventReviewListQueryDto = z.infer<
  typeof eventReviewListQuerySchema
>;
