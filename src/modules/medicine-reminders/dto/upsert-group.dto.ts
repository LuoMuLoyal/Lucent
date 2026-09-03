import { z } from 'zod';

/**
 * Standard Schema (zod 4) for one slot inside
 * `PUT /medicine-reminders/group`.
 *
 * Replaces the former class-validator nested DTO (`@ValidateNested` +
 * `@Type`): the slot schema is referenced directly by the group schema.
 * `.strict()` keeps the previous reject-unknown-keys posture.
 */
export const upsertReminderSlotSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe('Existing reminder id to update. Omit to create a new slot.')
      .optional(),
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
  })
  .strict();

/** One slot of the group upsert body. */
export type UpsertReminderSlotDto = z.infer<typeof upsertReminderSlotSchema>;

/**
 * Standard Schema (zod 4) for the `PUT /medicine-reminders/group` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` / `.nullish()` per the declared shape;
 * - `@IsString` + `@IsNotEmpty`/`@MaxLength` → `.min(1)` / `.max(n)`;
 * - `@IsDateString` → `z.iso.date()` (calendar date `YYYY-MM-DD` only);
 * - `@ValidateNested` + `@Type(() => UpsertReminderSlotDto)` →
 *   `z.array(upsertReminderSlotSchema)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const upsertMedicineReminderGroupSchema = z
  .object({
    currentMedicineId: z
      .string()
      .min(1)
      .describe('Linked current medicine id.'),
    label: z.string().min(1).max(200).describe('Reminder label.').nullish(),
    daysOfWeek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .describe('Weekday numbers 0-6, where null means every day.')
      .nullish(),
    startDate: z.iso
      .date()
      .describe('Date in YYYY-MM-DD format when the reminder starts.')
      .nullish(),
    endDate: z.iso
      .date()
      .describe('Date in YYYY-MM-DD format when the reminder ends.')
      .nullish(),
    isActive: z
      .boolean()
      .describe('Whether this reminder is active.')
      .optional(),
    note: z.string().max(500).describe('User note.').nullish(),
    slots: z
      .array(upsertReminderSlotSchema)
      .min(1)
      .describe('Reminder slots for this medicine. Replaces the whole group.'),
  })
  .strict();

/** Strongly typed body of `PUT /medicine-reminders/group`. */
export type UpsertMedicineReminderGroupDto = z.infer<
  typeof upsertMedicineReminderGroupSchema
>;
