import { z } from 'zod';
import { HealthEventOutcome } from '#generated/prisma/client.js';

/**
 * Request schema for `POST /health-events/:id/end`.
 *
 * Replaces the former class-validator DTO (`@IsEnum` on a required field);
 * the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const endHealthEventSchema = z
  .object({
    outcome: z
      .enum(HealthEventOutcome)
      .describe('User-confirmed outcome when ending the event.'),
  })
  .strict();

/** Strongly typed end body of `POST /health-events/:id/end`. */
export type EndHealthEventDto = z.infer<typeof endHealthEventSchema>;
