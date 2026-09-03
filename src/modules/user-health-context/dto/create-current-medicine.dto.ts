import { z } from 'zod';
import { MedicineSource } from '#generated/prisma/client.js';

/**
 * Standard Schema (zod 4) for `POST /health-context/current-medicines` body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsEnum` → `z.enum(...)` reusing the Prisma enum const object;
 * - `@IsNotEmpty` + `@MaxLength` → `.min/.max`;
 * - `@Matches` date-only format → `.regex`;
 * - `sourceRefId` was gated by `@ValidateIf` (required non-empty only for
 *   `drugbank`/`cn` sources) — mirrored with an object-level `superRefine`;
 * - unknown keys are rejected (`.strict()`, forbidNonWhitelisted parity).
 */
export const createCurrentMedicineSchema = z
  .object({
    source: z
      .enum(MedicineSource)
      .describe('Upstream source used to anchor this medicine.'),
    sourceRefId: z
      .string()
      .describe(
        'Source-specific reference id. Required for drugbank and cn sources.',
      )
      .optional(),
    displayName: z
      .string()
      .min(1, 'displayName must not be empty')
      .max(200, 'displayName must not be longer than 200 characters')
      .describe('Display name shown to the user.'),
    strengthText: z
      .string()
      .max(200, 'strengthText must not be longer than 200 characters')
      .describe('Strength text.')
      .optional(),
    doseText: z
      .string()
      .max(500, 'doseText must not be longer than 500 characters')
      .describe('Dose text.')
      .optional(),
    route: z
      .string()
      .max(100, 'route must not be longer than 100 characters')
      .describe('Administration route.')
      .optional(),
    startedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'startedAt must be in YYYY-MM-DD format')
      .describe('Start date in YYYY-MM-DD format.')
      .nullable()
      .optional(),
    endedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'endedAt must be in YYYY-MM-DD format')
      .describe('End date in YYYY-MM-DD format.')
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, 'note must not be longer than 1000 characters')
      .describe('User note for the medicine.')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const anchored =
      value.source === MedicineSource.drugbank ||
      value.source === MedicineSource.cn;
    if (
      anchored &&
      (value.sourceRefId === undefined || value.sourceRefId.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceRefId'],
        message: 'sourceRefId is required for drugbank and cn sources',
      });
    }
  });

/** Strongly typed body of `POST /health-context/current-medicines`. */
export type CreateCurrentMedicineDto = z.infer<
  typeof createCurrentMedicineSchema
>;
