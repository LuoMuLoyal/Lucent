import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the `PATCH /medicine-reminders/:id` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsOptional` + nullable type → `.nullish()` (null clears the column while
 *   an absent key leaves it untouched);
 * - `@IsString` + `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)`;
 * - `@IsInt` + `@Min`/`@Max` → `z.number().int().min(...).max(...)`;
 * - `@IsDateString` → `z.iso.date()` (calendar date `YYYY-MM-DD` only — the
 *   documented/consumed shape);
 * - `@IsBoolean` → `z.boolean()`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected).
 */
export const updateMedicineReminderSchema = z
  .object({
    currentMedicineId: z
      .string()
      .min(1)
      .describe('Linked current medicine id.')
      .nullish(),
    label: z.string().min(1).max(200).describe('Reminder label.').nullish(),
    scheduledHour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe('Scheduled local hour, 0-23.')
      .optional(),
    scheduledMinute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .describe('Scheduled local minute, 0-59.')
      .optional(),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .describe('Weekday numbers 0-6, where null means every day.')
      .nullish(),
    startDate: z.iso
      .date()
      .describe(
        'Date in YYYY-MM-DD format when the reminder starts. Use null to clear.',
      )
      .nullish(),
    endDate: z.iso
      .date()
      .describe(
        'Date in YYYY-MM-DD format when the reminder ends. Use null to clear.',
      )
      .nullish(),
    isActive: z
      .boolean()
      .describe('Whether this reminder is active.')
      .optional(),
    note: z.string().min(1).max(500).describe('User note.').nullish(),
  })
  .strict();

/** Strongly typed body of `PATCH /medicine-reminders/:id`. */
export type UpdateMedicineReminderDto = z.infer<
  typeof updateMedicineReminderSchema
>;
