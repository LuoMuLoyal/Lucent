import { z } from 'zod';

import { DoseLogStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for the `PATCH /medicine-dose-logs/:id` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsOptional` + nullable type → `.nullish()` (null clears the column while
 *   an absent key leaves it untouched);
 * - `@IsEnum(DoseLogStatus)` → `z.enum(DoseLogStatus)`;
 * - `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const updateDoseLogSchema = z
  .object({
    status: z.enum(DoseLogStatus).optional(),
    doseText: z.string().min(1).max(200).nullish(),
    note: z.string().min(1).max(500).nullish(),
  })
  .strict();

/** Strongly typed body of `PATCH /medicine-dose-logs/:id`. */
export type UpdateDoseLogDto = z.infer<typeof updateDoseLogSchema>;
