import { z } from 'zod';
import { dateOnlySchema } from '../../../common/validators/iso-datetime.schema.js';

/**
 * Standard Schema (zod 4) for the `POST /medicine-reminders` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsOptional` + nullable type → `.nullish()` (null and absent both pass);
 * - `@IsString` + `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)`;
 * - `@IsInt` + `@Min`/`@Max` → `z.number().int().min(...).max(...)`;
 * - `@IsDateString` → `dateOnlySchema()` (calendar date `YYYY-MM-DD` only — the
 *   documented/consumed shape; full datetimes would previously have produced an
 *   invalid Date in the mapper);
 * - `@IsBoolean` → `z.boolean()`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected).
 */
export const createMedicineReminderSchema = z
  .object({
    currentMedicineId: z
      .string()
      .min(1)
      .describe('Linked current medicine id.')
      .optional(),
    label: z.string().min(1).max(200).describe('Reminder label.').nullish(),
    scheduledHour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe('Scheduled local hour, 0-23.'),
    scheduledMinute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .describe('Scheduled local minute, 0-59.'),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .describe('Weekday numbers 0-6, where null means every day.')
      .nullish(),
    startDate: dateOnlySchema()
      .describe('Date in YYYY-MM-DD format when the reminder starts.')
      .nullish(),
    endDate: dateOnlySchema()
      .describe('Date in YYYY-MM-DD format when the reminder ends.')
      .nullish(),
    isActive: z
      .boolean()
      .describe('Whether this reminder is active.')
      .optional(),
    note: z.string().max(500).describe('User note.').nullish(),
  })
  .strict();

/** Strongly typed body of `POST /medicine-reminders`. */
export type CreateMedicineReminderDto = z.infer<
  typeof createMedicineReminderSchema
>;
