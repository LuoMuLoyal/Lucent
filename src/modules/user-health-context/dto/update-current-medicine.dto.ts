import { z } from 'zod';
import { MedicineSource } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `PATCH /health-context/current-medicines/:id`
 * body.
 *
 * Replaces the former class-validator DTO: every field is optional; fields
 * mapped to nullable columns keep `.nullable()` so `null` clears the stored
 * value, while non-nullable columns reject `null`.
 */
export const updateCurrentMedicineSchema = z
  .object({
    source: z.enum(MedicineSource).describe('Upstream source.').optional(),
    sourceRefId: z
      .string()
      .max(100, 'sourceRefId must not be longer than 100 characters')
      .describe('Source-specific reference id.')
      .nullable()
      .optional(),
    displayName: z
      .string()
      .max(200, 'displayName must not be longer than 200 characters')
      .describe('Display name shown to the user.')
      .optional(),
    strengthText: z
      .string()
      .max(200, 'strengthText must not be longer than 200 characters')
      .describe('Strength text. Use null to clear.')
      .nullable()
      .optional(),
    doseText: z
      .string()
      .max(500, 'doseText must not be longer than 500 characters')
      .describe('Dose text. Use null to clear.')
      .nullable()
      .optional(),
    route: z
      .string()
      .max(100, 'route must not be longer than 100 characters')
      .describe('Administration route. Use null to clear.')
      .nullable()
      .optional(),
    startedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'startedAt must be in YYYY-MM-DD format')
      .describe('Start date in YYYY-MM-DD format. Use null to clear.')
      .nullable()
      .optional(),
    endedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'endedAt must be in YYYY-MM-DD format')
      .describe('End date in YYYY-MM-DD format. Use null to clear.')
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note. Use null to clear.')
      .nullable()
      .optional(),
    isCurrent: z
      .boolean()
      .describe('Whether the medicine is currently active.')
      .optional(),
  })
  .strict();

/** Strongly typed body of `PATCH /health-context/current-medicines/:id`. */
export type UpdateCurrentMedicineDto = z.infer<
  typeof updateCurrentMedicineSchema
>;
