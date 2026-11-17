import { z } from 'zod';
import { HealthEventOutcome } from '#generated/prisma/client.js';

/**
 * Request schema for `PUT /health-events/:id/check-ins/:date`.
 *
 * Replaces the former class-validator DTO (`@IsEnum` on a required field);
 * the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const upsertHealthEventCheckInSchema = z
  .object({
    outcome: z
      .enum(HealthEventOutcome)
      .describe('User-confirmed outcome for the requested calendar date.'),
  })
  .strict();

/** Strongly typed check-in body of `PUT /health-events/:id/check-ins/:date`. */
export type UpsertHealthEventCheckInDto = z.infer<
  typeof upsertHealthEventCheckInSchema
>;
