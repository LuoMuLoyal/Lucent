import { z } from 'zod';
import {
  ActivityLevel,
  SexAtBirth,
  UnitSystem,
} from '#generated/prisma/client.js';
import { DIETARY_PREFERENCE_VALUES } from '../types/health-context.types.js';

/**
 * Standard Schema (zod 4) for `PATCH /health-context/profile` body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsString` + `@MaxLength` → `z.string().max(...)`;
 * - `@IsEnum` → `z.enum(...)` reusing the Prisma enum const object;
 * - `@Matches` date-only format → `.regex`;
 * - `@IsInt` + `@Min/@Max` → `z.number().int().min/.max`;
 * - `@IsOptional` → `.optional()`; nullable columns keep `.nullable()` so
 *   `null` clears the stored value (empty string is handled by the write
 *   service's `normalizeNullableText`, unchanged);
 * - unknown keys are rejected (`.strict()`, forbidNonWhitelisted parity).
 */
export const updateHealthContextProfileSchema = z
  .object({
    locale: z
      .string()
      .max(32, 'locale must not be longer than 32 characters')
      .describe(
        'Preferred locale. Use null or empty string to clear and follow the client default.',
      )
      .nullable()
      .optional(),
    timezone: z
      .string()
      .max(64, 'timezone must not be longer than 64 characters')
      .describe('Preferred timezone. Use null or empty string to clear.')
      .nullable()
      .optional(),
    unitSystem: z
      .enum(UnitSystem)
      .describe('Preferred unit system. Use null to clear.')
      .nullable()
      .optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be in YYYY-MM-DD format')
      .describe('Birth date in YYYY-MM-DD format.')
      .nullable()
      .optional(),
    sexAtBirth: z
      .enum(SexAtBirth)
      .describe('Sex assigned at birth. Use null to clear.')
      .nullable()
      .optional(),
    heightCm: z
      .number()
      .int('heightCm must be an integer')
      .min(1, 'heightCm must not be less than 1')
      .max(300, 'heightCm must not be greater than 300')
      .describe('Height in centimeters. Use null to clear.')
      .nullable()
      .optional(),
    activityLevel: z
      .enum(ActivityLevel)
      .describe('Self-reported activity level. Use null to clear.')
      .nullable()
      .optional(),
    dietaryPreferences: z
      .enum(DIETARY_PREFERENCE_VALUES)
      .array()
      .max(5, 'dietaryPreferences must not contain more than 5 items')
      .describe(
        'Dietary preferences. Stored in extras JSONB. Use null to clear.',
      )
      .nullable()
      .optional(),
    weightKg: z
      .number()
      .int('weightKg must be an integer')
      .min(1, 'weightKg must not be less than 1')
      .max(500, 'weightKg must not be greater than 500')
      .describe(
        'Weight in kilograms. Stored in extras JSONB. Use null to clear.',
      )
      .nullable()
      .optional(),
    onboardingCompleted: z
      .boolean()
      .describe(
        'Set true to complete onboarding (sets completedAt when missing). Set false to clear onboarding completion.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed body of `PATCH /health-context/profile`. */
export type UpdateHealthContextProfileDto = z.infer<
  typeof updateHealthContextProfileSchema
>;
