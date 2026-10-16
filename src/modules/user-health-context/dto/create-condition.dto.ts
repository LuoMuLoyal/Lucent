import { z } from 'zod';
import { UserConditionStatus } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `POST /health-context/conditions` body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsNotEmpty` + `@MaxLength` → `.min/.max`;
 * - `@Matches` date-only format → `.regex`;
 * - `@IsOptional` → `.optional()`;
 * - `@IsEnum` → `z.enum(...)` reusing the Prisma enum const object;
 * - unknown keys are rejected (`.strict()`, forbidNonWhitelisted parity).
 */
export const createHealthContextConditionSchema = z
  .object({
    label: z
      .string()
      .min(1, 'label must not be empty')
      .max(120, 'label must not be longer than 120 characters')
      .describe('Condition label.')
      .meta({ example: 'Type 2 diabetes' }),
    status: z
      .enum(UserConditionStatus)
      .describe('Condition status. Defaults to active.')
      .meta({ example: 'active' })
      .optional(),
    diagnosedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'diagnosedAt must be in YYYY-MM-DD format')
      .describe('Diagnosis date in YYYY-MM-DD format.')
      .meta({ example: '2024-03-15' })
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note for the condition.')
      .meta({ example: 'Managed with diet and metformin.' })
      .optional(),
  })
  .strict();

/** Strongly typed body of `POST /health-context/conditions`. */
export type CreateHealthContextConditionDto = z.infer<
  typeof createHealthContextConditionSchema
>;
