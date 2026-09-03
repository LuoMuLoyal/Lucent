import { z } from 'zod';

/**
 * Standard Schema (zod 4) for `POST /files/upload` request body.
 *
 * Replaces the former class-validator DTO:
 * - `@IsString` + `@MinLength/@MaxLength/@Matches` → string checks; the body
 *   is a JSON payload (no `@Type` coercion was present), so numeric fields
 *   stay `z.number()` — a numeric string is still rejected, as before;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 */
export const createFileUploadSchema = z
  .object({
    contentType: z
      .string()
      .min(1)
      .regex(/^[a-z]+\/[-a-z0-9+.]+$/i)
      .describe('MIME type'),
    sizeBytes: z.number().int().positive().describe('File size in bytes'),
    fileName: z
      .string()
      .max(255)
      .regex(/^[^\\/]+$/)
      .describe('Original filename')
      .optional(),
  })
  .strict();

/** Strongly typed request body of `POST /files/upload`. */
export type CreateFileUploadDto = z.infer<typeof createFileUploadSchema>;
