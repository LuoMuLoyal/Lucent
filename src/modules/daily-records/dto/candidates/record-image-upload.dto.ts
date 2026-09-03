import { z } from 'zod';

/**
 * Standard Schema (zod 4) for
 * `POST /daily-records/attachments/images/presign-upload`.
 *
 * Replaces the former class-validator `CreateDailyRecordImageUploadDto`
 * (JSON body, so numbers arrive as numbers — no `z.coerce`):
 * - `@MaxLength` → `.max(...)`; `@IsInt`/`@Min`/`@Max` →
 *   `z.number().int().min/max(...)`;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const createDailyRecordImageUploadSchema = z
  .object({
    contentType: z.string().max(100).describe('Image MIME content type.'),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(50_000_000)
      .describe('File size in bytes.'),
    fileName: z.string().max(255).describe('Original file name.').optional(),
  })
  .strict();

/** Strongly typed create body of the presigned image upload endpoint. */
export type CreateDailyRecordImageUploadDto = z.infer<
  typeof createDailyRecordImageUploadSchema
>;

/**
 * Standard Schema (zod 4) for the presigned image-upload response
 * (`POST /daily-records/attachments/images/presign-upload`, 201).
 *
 * Replaces the former `@ApiProperty` class `DailyRecordImageUploadDto`
 * (`DailyRecordImageUploadResponseDto` extended it without adding fields).
 * The service always emits every key; `publicUrl` is `null` when no public
 * base URL is configured.
 */
export const dailyRecordImageUploadSchema = z.object({
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

/** Strongly typed presigned image-upload response payload. */
export type DailyRecordImageUploadDto = z.infer<
  typeof dailyRecordImageUploadSchema
>;

/**
 * Standard Schema (zod 4) for the presign-upload (201) response body.
 *
 * Replaces the former response class `DailyRecordImageUploadResponseDto`.
 */
export const dailyRecordImageUploadResponseSchema =
  dailyRecordImageUploadSchema;

/** Strongly typed response body of the presign-upload endpoint. */
export type DailyRecordImageUploadResponseDto = z.infer<
  typeof dailyRecordImageUploadResponseSchema
>;
