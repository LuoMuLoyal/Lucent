import { z } from 'zod';
import { dateOnlySchema } from '../../../common/validators/iso-datetime.schema.js';

/**
 * Calendar date in `YYYY-MM-DD` format (real date, same strictness as the
 * former `@IsDateString({ strict: true })` + `^\d{4}-\d{2}-\d{2}$` combo).
 * Shared by the optional list/active/detail `date` query parameter and the
 * `PUT /health-events/:id/check-ins/:date` path date.
 */
export const eventDateSchema = dateOnlySchema().describe(
  'Calendar date in YYYY-MM-DD format.',
);

/**
 * Request schema for the optional `date` query of the health-event list,
 * active and detail endpoints.
 *
 * Replaces the former class-validator DTO (`@IsOptional` → `.optional()`);
 * the global `forbidNonWhitelisted` posture is preserved with `.strict()`
 * (unknown query keys are rejected).
 */
export const eventListQuerySchema = z
  .object({
    date: eventDateSchema.optional(),
  })
  .strict();

/** Strongly typed query object of the health-event list/active/detail reads. */
export type EventListQueryDto = z.infer<typeof eventListQuerySchema>;
