import { z } from 'zod';

import { DoseLogStatus } from '#generated/prisma/client.js';
import { dateOnlySchema } from '../../../../../common/validators/iso-datetime.schema.js';

/**
 * Standard Schemas (zod 4) for the dose-log request bodies.
 *
 * Mapping kept from the class-validator era:
 * - `@IsOptional` -> `.optional()` (absent keys stay `undefined`);
 * - optional + nullable -> `.nullish()` (null and absent both pass);
 * - `@IsNotEmpty`/`@MaxLength` -> `.min(1)` / `.max(n)`;
 * - `@IsUUID` -> `.uuid()`;
 * - `@IsEnum(DoseLogStatus)` -> `z.enum(DoseLogStatus)`;
 * - `@IsDateString` -> `dateOnlySchema()` (calendar date `YYYY-MM-DD` only — the
 *   documented `scheduledFor` format; full datetimes would produce an invalid
 *   Date downstream);
 * - `@Matches(/^\d{2}:\d{2}$/)` -> `.regex(...)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */

/** `POST /medicine-dose-logs`. */
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

/** `POST /medicine-dose-logs/mark` (idempotent per slot). */
export const markDoseLogSchema = z
  .object({
    currentMedicineId: z
      .string()
      .min(1)
      .describe('Linked current medicine id.')
      .optional(),
    reminderId: z
      .string()
      .min(1)
      .describe('Linked reminder id for slot-aware marks.')
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
      .describe('Scheduled slot time in HH:mm for slot-aware marks.')
      .optional(),
    doseText: z.string().min(1).max(200).describe('Dose text.').nullish(),
    note: z.string().max(500).describe('Free-text note.').nullish(),
  })
  .strict();

/** Strongly typed body of `POST /medicine-dose-logs/mark`. */
export type MarkDoseLogDto = z.infer<typeof markDoseLogSchema>;

/** `PATCH /medicine-dose-logs/:id`. */
export const updateDoseLogSchema = z
  .object({
    status: z.enum(DoseLogStatus).optional(),
    doseText: z.string().min(1).max(200).nullish(),
    note: z.string().min(1).max(500).nullish(),
  })
  .strict();

/** Strongly typed body of `PATCH /medicine-dose-logs/:id`. */
export type UpdateDoseLogDto = z.infer<typeof updateDoseLogSchema>;
