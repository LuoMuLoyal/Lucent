import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `GET /environment/snapshot` query parameters.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@Type(() => Number)` + `@IsNumber` → `z.coerce.number()` (query values
 *   arrive as strings; numeric strings are coerced, malformed ones fail);
 * - `@Min/@Max` → `.min/.max` (inclusive, same semantics);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown query keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 */
export const environmentSnapshotQuerySchema = z
  .object({
    lat: z.coerce
      .number({ message: 'lat must be a number' })
      .min(-90, 'lat must be between -90 and 90')
      .max(90, 'lat must be between -90 and 90')
      .describe('Approximate latitude.')
      .optional(),
    lon: z.coerce
      .number({ message: 'lon must be a number' })
      .min(-180, 'lon must be between -180 and 180')
      .max(180, 'lon must be between -180 and 180')
      .describe('Approximate longitude.')
      .optional(),
  })
  .strict();

/** Strongly typed query object of `GET /environment/snapshot`. */
export type EnvironmentSnapshotQueryDto = z.infer<
  typeof environmentSnapshotQuerySchema
>;
