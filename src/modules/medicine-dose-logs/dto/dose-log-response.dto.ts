import { z } from 'zod';

import { DoseLogStatus } from '#generated/prisma/client.js';

/**
 * zod 4 Standard Schemas for the medicine dose-log response bodies
 * (`GET`/`POST`/`PATCH /medicine-dose-logs`).
 *
 * Migrated from the former `@ApiProperty` response classes (class names kept
 * as `z.infer` type aliases; descriptions preserved via `.describe`):
 * - nullable columns → `.nullable()` (key always present, value may be null);
 * - `@IsEnum`-style `DoseLogStatus` → `z.enum(DoseLogStatus)` (Prisma exports
 *   a const object);
 * - date/time strings stay plain strings (no `format` added) so the client
 *   contract for `scheduledFor`/`createdAt` is unchanged.
 *
 * No `.strict()` / `.default()` — outbound validation must accept the wire
 * shape produced by `MedicineDoseLogsService.toItem` (every key present).
 */

export const doseLogItemSchema = z.object({
  id: z.string().describe('Dose log id.'),
  healthEventId: z.string().nullable().describe('Linked health event id.'),
  currentMedicineId: z
    .string()
    .nullable()
    .describe('Linked current medicine id.'),
  reminderId: z
    .string()
    .nullable()
    .describe('Linked reminder id for slot-aware logs.'),
  status: z.enum(DoseLogStatus).describe('Dose log status.'),
  scheduledFor: z.string().describe('Scheduled date in YYYY-MM-DD format.'),
  scheduledTime: z
    .string()
    .nullable()
    .describe('Scheduled slot time in HH:mm format.'),
  doseText: z.string().nullable().describe('Dose text.'),
  note: z.string().nullable().describe('Free-text note.'),
  source: z.string().nullable().describe('Source.'),
  createdAt: z.string().describe('Created at (ISO 8601).'),
  updatedAt: z.string().describe('Updated at (ISO 8601).'),
});

export const doseLogListDataSchema = z.object({
  items: z.array(doseLogItemSchema).describe('Dose logs for the date.'),
  total: z.number().describe('Total count of dose logs for the date.'),
});

/** List body: dose logs for the requested date. */
export const doseLogListResponseSchema = doseLogListDataSchema;

/** Single dose log body (create / mark / update). */
export const doseLogResponseSchema = doseLogItemSchema;

/** Strongly typed single dose log. */
export type DoseLogResponseDto = z.infer<typeof doseLogResponseSchema>;

/** Strongly typed dose-log list body. */
export type DoseLogListResponseDto = z.infer<typeof doseLogListResponseSchema>;
