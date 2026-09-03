import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the authenticated user's notification
 * preferences resource (`GET`/`PATCH /notification-preferences`).
 *
 * Replaces the former `NotificationPreferencesDataDto` response class.
 * Response schemas intentionally carry no `.strict()` / `.default()` so
 * outbound parsing tolerates whatever the service layer produces.
 */
export const notificationPreferencesSchema = z.object({
  healthAlertsEnabled: z.boolean(),
  weeklyInsightEnabled: z.boolean(),
  waterRemindersEnabled: z.boolean(),
  sleepReminderEnabled: z.boolean(),
  sleepBedtimeMinutes: z.number().int().nullable(),
  sleepWakeTimeMinutes: z.number().int().nullable(),
  configured: z
    .boolean()
    .describe('Whether the user has a persisted preference row.'),
  updatedAt: z.string().nullable(),
});

/** Strongly typed notification preferences resource. */
export type NotificationPreferencesDataDto = z.infer<
  typeof notificationPreferencesSchema
>;

/** Backwards-compatible response alias kept for the former DTO class name. */
export type NotificationPreferencesResponseDto = NotificationPreferencesDataDto;
