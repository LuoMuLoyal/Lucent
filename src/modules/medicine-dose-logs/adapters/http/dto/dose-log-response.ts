import { z } from 'zod';

import { DoseLogStatus } from '#generated/prisma/client.js';
import type {
  DoseLogListResource,
  DoseLogResource,
} from '../../../application/ports/dose-log-resource.js';

/**
 * zod 4 Standard Schemas for the medicine dose-log response bodies
 * (`GET`/`POST`/`PATCH /medicine-dose-logs`).
 *
 * `satisfies z.ZodType<DoseLogResource>` pins each schema to the
 * application-owned resource type, so the wire contract cannot drift from what
 * the use cases render while the dependency only points inward (ADR-0024 D2).
 *
 * No `.strict()` / `.default()` — outbound validation must accept exactly the
 * shape the read model produces (every key present).
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

/** Single dose log body (create / mark / update). */
export const doseLogResponseSchema =
  doseLogItemSchema satisfies z.ZodType<DoseLogResource>;

/** List body: dose logs for the requested date. */
export const doseLogListResponseSchema =
  doseLogListDataSchema satisfies z.ZodType<DoseLogListResource>;

/** Strongly typed single dose log (the wire shape). */
export type DoseLogResponseDto = DoseLogResource;

/** Strongly typed dose-log list body (the wire shape). */
export type DoseLogListResponseDto = DoseLogListResource;
