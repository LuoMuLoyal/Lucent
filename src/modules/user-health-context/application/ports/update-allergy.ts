import { z } from 'zod';
import { isoDateOrDatetimeSchema } from '../../../../common/validators/iso-datetime.schema.js';
import {
  UserAllergyKind,
  UserAllergySeverity,
} from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `PATCH /health-context/allergies/:id` body.
 *
 * Replaces the former class-validator DTO: every field is optional; fields
 * that map to nullable columns keep `.nullable()` so `null` still clears the
 * stored value (`severity`/`reaction`/`note`/`recordedAt`), while the others
 * reject `null` like their declared non-nullable types.
 */
export const updateHealthContextAllergySchema = z
  .object({
    kind: z
      .enum(UserAllergyKind)
      .describe('Allergy kind.')
      .meta({ example: 'food' })
      .optional(),
    label: z
      .string()
      .max(120, 'label must not be longer than 120 characters')
      .describe('User-visible allergy label.')
      .meta({ example: 'Peanut' })
      .optional(),
    reaction: z
      .string()
      .max(1000, 'reaction must not be longer than 1000 characters')
      .describe('Recorded reaction. Use null to clear.')
      .meta({ example: 'Hives and swelling' })
      .nullable()
      .optional(),
    severity: z
      .enum(UserAllergySeverity)
      .describe('Severity level.')
      .meta({ example: 'moderate' })
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note for the allergy. Use null to clear.')
      .meta({ example: 'Avoid peanuts and peanut oil.' })
      .nullable()
      .optional(),
    recordedAt: isoDateOrDatetimeSchema({ allowLocal: true })
      .describe('When this allergy was recorded in ISO 8601 format.')
      .meta({ example: '2026-06-04T08:30:00.000Z' })
      .nullable()
      .optional(),
    isActive: z
      .boolean()
      .describe('Whether the allergy is currently active.')
      .meta({ example: true })
      .optional(),
  })
  .strict();

/** Strongly typed body of `PATCH /health-context/allergies/:id`. */
export type UpdateHealthContextAllergyDto = z.infer<
  typeof updateHealthContextAllergySchema
>;
