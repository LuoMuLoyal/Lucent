import { z } from 'zod';
import { UserConditionStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `PATCH /health-context/conditions/:id` body.
 *
 * Replaces the former class-validator DTO: every field is optional; fields
 * mapped to nullable columns keep `.nullable()` so `null` clears the stored
 * value (`diagnosedAt`/`note`), while non-nullable columns reject `null`.
 */
export const updateHealthContextConditionSchema = z
  .object({
    label: z
      .string()
      .max(120, 'label must not be longer than 120 characters')
      .describe('Condition label.')
      .optional(),
    status: z
      .enum(UserConditionStatus)
      .describe('Condition status.')
      .optional(),
    diagnosedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'diagnosedAt must be in YYYY-MM-DD format')
      .describe('Diagnosis date in YYYY-MM-DD format. Use null to clear.')
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note for the condition. Use null to clear.')
      .nullable()
      .optional(),
  })
  .strict();

/** Strongly typed body of `PATCH /health-context/conditions/:id`. */
export type UpdateHealthContextConditionDto = z.infer<
  typeof updateHealthContextConditionSchema
>;
