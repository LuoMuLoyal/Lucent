import { z } from 'zod';
import { HealthEventKind } from '#generated/prisma/client.js';

/**
 * Request schema for `POST /health-events` (start a user-confirmed event).
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()`;
 * - `@IsString`/`@IsNotEmpty` + `@Matches(/\S/)` → `z.string().regex(/\S/)`
 *   (whitespace-only values are rejected without trimming the stored value);
 * - `@MaxLength(80)` → `.max(80)`;
 * - `@IsEnum` → `z.enum(...)` over the Prisma const enum;
 * - `@IsArray` + element checks → `z.array(...)`;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`
 *   (unknown body keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 */
export const createHealthEventSchema = z
  .object({
    kind: z
      .enum(HealthEventKind)
      .describe('Persisted semantic kind used for check-in routing.')
      .optional(),
    title: z
      .string()
      .max(80)
      .regex(/\S/, 'title must contain a non-whitespace character')
      .describe('Short user-defined event title.'),
    reasonRecordId: z
      .string()
      .regex(/\S/)
      .nullable()
      .optional()
      .describe('Optional daily-record id that prompted this event.'),
    currentMedicineIds: z
      .array(z.string().regex(/\S/))
      .optional()
      .describe('Optional current-medicine ids to associate with this event.'),
  })
  .strict();

/** Strongly typed create body of `POST /health-events`. */
export type CreateHealthEventDto = z.infer<typeof createHealthEventSchema>;
