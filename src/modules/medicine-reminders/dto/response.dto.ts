import { z } from 'zod';

/**
 * zod 4 Standard Schemas for the medicine-reminder response bodies
 * (`GET`/`POST`/`PATCH /medicine-reminders`, `PUT /medicine-reminders/group`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; descriptions preserved via `.describe`):
 * - nullable columns → `.nullable()` (key always present, value may be null);
 * - `daysOfWeek` is a nullable number array (JSON column; `null` means every
 *   day); date strings stay plain strings (no `format` added) so the client
 *   contract is unchanged.
 *
 * No `.strict()` / `.default()` — outbound validation must accept the wire
 * shape produced by `MedicineRemindersMapperService.toItem` (every key
 * present).
 */

export const medicineReminderItemSchema = z.object({
  id: z.string().describe('Reminder id.'),
  currentMedicineId: z
    .string()
    .nullable()
    .describe('Linked current medicine id.'),
  label: z.string().nullable().describe('Reminder label.'),
  scheduledHour: z.number().describe('Scheduled local hour, 0-23.'),
  scheduledMinute: z.number().describe('Scheduled local minute, 0-59.'),
  daysOfWeek: z
    .array(z.number())
    .nullable()
    .describe('Weekday numbers 0-6. Null means every day.'),
  startDate: z
    .string()
    .nullable()
    .describe('Date in YYYY-MM-DD format when the reminder starts.'),
  endDate: z
    .string()
    .nullable()
    .describe('Date in YYYY-MM-DD format when the reminder ends.'),
  isActive: z.boolean().describe('Whether this reminder is active.'),
  note: z.string().nullable().describe('User note.'),
  createdAt: z.string().describe('Created at (ISO 8601).'),
  updatedAt: z.string().describe('Updated at (ISO 8601).'),
});

export const medicineReminderListDataSchema = z.object({
  items: z.array(medicineReminderItemSchema).describe('Medicine reminders.'),
});

/** List body (list + group upsert). */
export const medicineReminderListResponseSchema =
  medicineReminderListDataSchema;

/** Single reminder body (create / update). */
export const medicineReminderResponseSchema = medicineReminderItemSchema;

/** Strongly typed single medicine reminder. */
export type MedicineReminderItemDto = z.infer<
  typeof medicineReminderItemSchema
>;

/** Strongly typed reminder list payload. */
export type MedicineReminderListDataDto = z.infer<
  typeof medicineReminderListDataSchema
>;

/** Strongly typed reminder list body. */
export type MedicineReminderListResponseDto = z.infer<
  typeof medicineReminderListResponseSchema
>;

/** Strongly typed single reminder body. */
export type MedicineReminderResponseDto = z.infer<
  typeof medicineReminderResponseSchema
>;
