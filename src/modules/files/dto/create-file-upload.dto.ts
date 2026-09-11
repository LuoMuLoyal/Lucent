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

/**
 * Standard Schema (zod 4) for the presigned upload response
 * (`POST /files/upload`, 200).
 *
 * Mirrors `dailyRecordImageUploadSchema`: the service always emits every key,
 * and `publicUrl` is `null` when no public base URL is configured for the
 * active storage provider. Without this registration the OpenAPI 200 carried
 * no content schema and the generated clients returned an empty body, which
 * forced callers to parse the raw JSON by hand.
 */
export const createFileUploadResponseSchema = z.object({
  provider: z.string(),
  bucket: z.string(),
  objectKey: z.string(),
  uploadUrl: z
    .string()
    .describe('Signed PUT URL for direct object storage upload.'),
  headers: z
    .record(z.string(), z.string())
    .describe('Headers that must be sent with the PUT upload.'),
  publicUrl: z
    .string()
    .describe('Optional public/CDN URL when a public base URL is configured.')
    .nullable(),
  expiresAt: z.string().describe('Signed URL expiry timestamp (ISO 8601).'),
  maxSizeBytes: z
    .number()
    .int()
    .describe('Maximum accepted upload size in bytes.'),
});

/** Strongly typed response body of `POST /files/upload`. */
export type CreateFileUploadResponseDto = z.infer<
  typeof createFileUploadResponseSchema
>;
