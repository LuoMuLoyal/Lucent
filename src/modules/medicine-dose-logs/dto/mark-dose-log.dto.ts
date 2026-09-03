import { z } from 'zod';

import { DoseLogStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for the `POST /medicine-dose-logs/mark` request body.
 *
 * Replaces the former class-validator DTO (mapping matches create-dose-log):
 * - `@IsOptional` → `.optional()`; nullable optional fields → `.nullish()`;
 * - `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)`;
 * - `@IsUUID` → `z.uuid()`; `@IsEnum(DoseLogStatus)` → `z.nativeEnum(...)`;
 * - `@IsDateString` → `z.iso.date()` (calendar date `YYYY-MM-DD`);
 * - `@Matches(/^\d{2}:\d{2}$/)` → `.regex(...)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
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
    scheduledFor: z.iso.date().describe('Scheduled date YYYY-MM-DD.'),
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
