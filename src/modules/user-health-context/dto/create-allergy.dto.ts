import { z } from 'zod';
import { isoDateOrDatetimeSchema } from '../../../common/validators/iso-datetime.schema.js';
import {
  UserAllergyKind,
  UserAllergySeverity,
} from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `POST /health-context/allergies` body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsEnum` → `z.enum(...)` reusing the Prisma enum const object;
 * - `@IsNotEmpty` + `@MaxLength` → `.min/.max`;
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsISO8601` → union of zod ISO date / date-time so both date-only and
 *   offset/local date-time strings keep passing;
 * - unknown keys are rejected (`.strict()`, forbidNonWhitelisted parity).
 */
export const createHealthContextAllergySchema = z
  .object({
    kind: z.enum(UserAllergyKind).describe('Allergy kind.'),
    label: z
      .string()
      .min(1, 'label must not be empty')
      .max(120, 'label must not be longer than 120 characters')
      .describe('User-visible allergy label.'),
    reaction: z
      .string()
      .max(1000, 'reaction must not be longer than 1000 characters')
      .describe('Recorded reaction.')
      .optional(),
    severity: z
      .enum(UserAllergySeverity)
      .describe('Severity level. Defaults to unknown.')
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note for the allergy.')
      .optional(),
    recordedAt: isoDateOrDatetimeSchema({ allowLocal: true })
      .describe('When this allergy was recorded in ISO 8601 format.')
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /health-context/allergies`. */
export type CreateHealthContextAllergyDto = z.infer<
  typeof createHealthContextAllergySchema
>;
