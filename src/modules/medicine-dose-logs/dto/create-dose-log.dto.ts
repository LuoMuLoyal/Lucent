import { z } from 'zod';
import { dateOnlySchema } from '../../../common/validators/iso-datetime.schema.js';

import { DoseLogStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for the `POST /medicine-dose-logs` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsOptional` + nullable type → `.nullish()` (null and absent both pass);
 * - `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)` (whitespace-only strings
 *   still pass, matching the class-validator default);
 * - `@IsUUID` → `z.uuid()`;
 * - `@IsEnum(DoseLogStatus)` → `z.enum(DoseLogStatus)` (Prisma exports a
 *   const object, not a TS enum);
 * - `@IsDateString` → `z.iso.date()` (calendar date `YYYY-MM-DD` only — the
 *   documented/consumed `scheduledFor` format; full datetimes would previously
 *   have produced an invalid Date in the service);
 * - `@Matches(/^\d{2}:\d{2}$/)` → `.regex(...)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected).
 */
export const createDoseLogSchema = z
  .object({
    currentMedicineId: z
      .string()
      .min(1)
      .describe('Linked current medicine id.')
      .optional(),
    reminderId: z
      .string()
      .min(1)
      .describe('Linked reminder id for slot-aware logs.')
      .optional(),
    healthEventId: z
      .uuid()
      .describe('Linked active health event id.')
      .nullish(),
    status: z.enum(DoseLogStatus),
    scheduledFor: dateOnlySchema().describe('Scheduled date YYYY-MM-DD.'),
    scheduledTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .describe('Scheduled slot time in HH:mm.')
      .optional(),
    doseText: z.string().min(1).max(200).describe('Dose text.').optional(),
    note: z.string().max(500).describe('Free-text note.').optional(),
  })
  .strict();

/** Strongly typed body of `POST /medicine-dose-logs`. */
export type CreateDoseLogDto = z.infer<typeof createDoseLogSchema>;
