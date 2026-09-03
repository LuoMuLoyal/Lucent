import { z } from 'zod';

/**
 * zod 4 Standard Schema for the `POST /medicines/recognize(/async)` body.
 *
 * Migrated from the former class-validator DTO:
 * - `@IsUrl({ require_tld: false })` → `z.url()` (accepts localhost / TLD-less
 *   hosts such as `http://localhost/...`; schemeless strings that the old
 *   validator tolerated are now rejected — deliberate tightening, the API
 *   contract documents an http(s) public URL);
 * - `@MaxLength(2048)` → `.max(2048)`;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const recognizeMedicineSchema = z
  .object({
    imageUrl: z
      .url({ message: 'imageUrl must be a valid URL' })
      .max(2048, 'imageUrl must be at most 2048 characters')
      .describe('Public URL of the medicine box image'),
  })
  .strict();

/** Strongly typed body of `POST /medicines/recognize(/async)`. */
export type RecognizeMedicineDto = z.infer<typeof recognizeMedicineSchema>;
