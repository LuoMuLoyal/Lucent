import { z } from 'zod';

import {
  HealthEventKind,
  HealthEventOutcome,
  HealthEventStatus,
} from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for one user-confirmed daily check-in of a health
 * event (nested in event responses).
 *
 * Replaces the former `@ApiProperty` response class
 * `HealthEventCheckInResponseDto`.
 */
export const healthEventCheckInResponseSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  date: z.string().describe('Calendar date in YYYY-MM-DD format.'),
  outcome: z.enum(HealthEventOutcome),
  createdAt: z.string().describe('Creation time in ISO 8601 format.'),
  updatedAt: z.string().describe('Last update time in ISO 8601 format.'),
});

/** Strongly typed daily check-in nested in health-event responses. */
export type HealthEventCheckInResponseDto = z.infer<
  typeof healthEventCheckInResponseSchema
>;

/**
 * Standard Schema (zod 4) for the check-in coverage block nested in health
 * event responses.
 *
 * Replaces the former `@ApiProperty` response class `HealthEventCoverageDto`.
 */
export const healthEventCoverageSchema = z.object({
  checkInCount: z
    .number()
    .int()
    .describe('Number of user-confirmed daily check-ins.'),
  firstCheckInDate: z
    .string()
    .describe('First check-in calendar date, or null when none exists.')
    .nullable(),
  lastCheckInDate: z
    .string()
    .describe('Last check-in calendar date, or null when none exists.')
    .nullable(),
});

/** Strongly typed check-in coverage block of health-event responses. */
export type HealthEventCoverageDto = z.infer<typeof healthEventCoverageSchema>;

/**
 * Standard Schema (zod 4) for one health-event read item — the wire shape of
 * the health-event detail/active/list payloads.
 *
 * Replaces the former `@ApiProperty` response class `HealthEventItemDto`. The
 * controller mapper always emits every key; nullable columns surface as an
 * explicit `null` and `checkIn` is `null` while no check-in exists.
 */
export const healthEventItemSchema = z.object({
  kind: z.enum(HealthEventKind),
  id: z.string(),
  title: z.string(),
  status: z.enum(HealthEventStatus),
  startedAt: z.string().describe('Start time in ISO 8601 format.'),
  endedAt: z
    .string()
    .describe('End time in ISO 8601 format, or null while active.')
    .nullable(),
  outcome: z.enum(HealthEventOutcome).nullable(),
  reasonRecordId: z.string().nullable(),
  currentMedicineIds: z.array(z.string()),
  checkIn: healthEventCheckInResponseSchema.nullable(),
  coverage: healthEventCoverageSchema,
});

/** Strongly typed health-event read item returned by event endpoints. */
export type HealthEventItemDto = z.infer<typeof healthEventItemSchema>;

/**
 * Standard Schema (zod 4) for the `GET /health-events` list payload.
 *
 * Replaces the former `@ApiProperty` data class `HealthEventListDataDto`.
 */
export const healthEventListDataSchema = z.object({
  items: z.array(healthEventItemSchema),
  total: z.number().int(),
});

/** Strongly typed health-event list payload of `GET /health-events`. */
export type HealthEventListDataDto = z.infer<typeof healthEventListDataSchema>;

/**
 * Standard Schema (zod 4) for the health-event responses whose body is one
 * event item (`POST /health-events`, `GET/PUT /health-events/:id...`).
 *
 * Replaces the former response class `HealthEventResponseDto` (which extended
 * `HealthEventItemDto` without adding fields).
 */
export const healthEventResponseSchema = healthEventItemSchema;

/** Strongly typed single-event response body of the event endpoints. */
export type HealthEventResponseDto = z.infer<typeof healthEventResponseSchema>;

/**
 * Standard Schema (zod 4) for `GET /health-events/active` (200): one event
 * item, or `null` when the user has no active event.
 *
 * Replaces the former response class `HealthEventNullableResponseDto`.
 */
export const healthEventNullableResponseSchema =
  healthEventItemSchema.nullable();

/** Strongly typed response body of `GET /health-events/active`. */
export type HealthEventNullableResponseDto = z.infer<
  typeof healthEventNullableResponseSchema
>;

/**
 * Standard Schema (zod 4) for `GET /health-events` (200).
 *
 * Replaces the former response class `HealthEventListResponseDto` (which
 * extended `HealthEventListDataDto` without adding fields).
 */
export const healthEventListResponseSchema = healthEventListDataSchema;

/** Strongly typed response body of `GET /health-events`. */
export type HealthEventListResponseDto = z.infer<
  typeof healthEventListResponseSchema
>;
