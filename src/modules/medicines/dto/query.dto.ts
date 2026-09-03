import { z } from 'zod';

/**
 * zod 4 Standard Schemas for `GET /medicines` query parameters.
 *
 * Migrated from the former class-validator DTOs (class names preserved as
 * `z.infer` type aliases):
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@Type(() => Number)` + `@IsInt` + class field defaults →
 *   `z.coerce.number().int()` with `.default(1)` / `.default(20)`;
 * - `@Min/@Max` → `.min/.max` (inclusive, same semantics);
 * - the repo-unique `@Transform` on `q` trimmed string values and dropped
 *   non-strings (query arrays etc.) to `undefined` → reproduced with
 *   `z.preprocess` feeding an optional `z.string().max(200)` (length check
 *   runs on the trimmed value, exactly like the decorator pipeline);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown query keys are rejected) — same posture as the old pipe.
 */
function trimOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export const medicineSearchQuerySchema = z
  .object({
    source: z.string().describe('Knowledge source selector.').optional(),
    q: z
      .preprocess(
        trimOptionalString,
        z.string().max(200).describe('Search keyword.').optional(),
      )
      .optional(),
    page: z.coerce
      .number({ message: 'page must be a number' })
      .int({ message: 'page must be an integer' })
      .min(1, 'page must be at least 1')
      .describe('Page number, 1-based.')
      .default(1),
    pageSize: z.coerce
      .number({ message: 'pageSize must be a number' })
      .int({ message: 'pageSize must be an integer' })
      .min(1, 'pageSize must be at least 1')
      .max(50, 'pageSize must be at most 50')
      .describe('Page size.')
      .default(20),
  })
  .strict();

/** Strongly typed query object of `GET /medicines` (search). */
export type MedicineSearchQueryDto = z.infer<typeof medicineSearchQuerySchema>;

export const medicineDetailQuerySchema = z
  .object({
    source: z.string().describe('Knowledge source selector.').optional(),
  })
  .strict();

/** Strongly typed query object of `GET /medicines/:id` (detail). */
export type MedicineDetailQueryDto = z.infer<typeof medicineDetailQuerySchema>;
