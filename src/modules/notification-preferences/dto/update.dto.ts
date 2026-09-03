import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `PATCH /notification-preferences` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` + `@IsBoolean` → `.boolean().optional()`;
 * - nullable sleep minutes: `@IsOptional` + `@IsInt` + `@Min/@Max` on
 *   `number | null` → `z.number().int().min().max().nullable().optional()`
 *   (`null` and `undefined` both accepted, mirroring `@IsOptional` skips);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const updateNotificationPreferencesSchema = z
  .object({
    healthAlertsEnabled: z
      .boolean()
      .describe('Enable health-rule notifications.')
      .optional(),
    weeklyInsightEnabled: z
      .boolean()
      .describe('Enable weekly longitudinal insights.')
      .optional(),
    waterRemindersEnabled: z
      .boolean()
      .describe('Enable water shortfall notifications.')
      .optional(),
    sleepReminderEnabled: z
      .boolean()
      .describe('Enable local bedtime sleep reminders.')
      .optional(),
    sleepBedtimeMinutes: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .describe('Bedtime as minutes after local midnight.')
      .nullable()
      .optional(),
    sleepWakeTimeMinutes: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .describe('Wake time as minutes after local midnight.')
      .nullable()
      .optional(),
  })
  .strict();

/** Strongly typed request body of `PATCH /notification-preferences`. */
export type UpdateNotificationPreferencesDto = z.infer<
  typeof updateNotificationPreferencesSchema
>;
