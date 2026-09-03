import { z } from 'zod';

import { DailyRecordAttachmentKind } from '#generated/prisma/client.js';

const DAILY_RECORD_ATTACHMENT_KIND_VALUES = Object.values(
  DailyRecordAttachmentKind,
) as [DailyRecordAttachmentKind, ...DailyRecordAttachmentKind[]];

/**
 * Standard Schema (zod 4) for one `attachments` entry of the daily-record
 * create/update payloads.
 *
 * Replaces the former class-validator `DailyRecordAttachmentInputDto`:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - nullable optionals (`@ApiPropertyOptional nullable: true`) → `.nullish()`
 *   (absent stays `undefined`, an explicit `null` is still accepted);
 * - `@MaxLength` → `.max(...)`; `@IsInt`/`@Min`/`@Max` →
 *   `z.number().int().min/max(...)`;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`
 *   (unknown keys inside an attachment object are rejected, matching the
 *   recursive whitelist behaviour of `@ValidateNested({ each: true })`).
 */
export const dailyRecordAttachmentInputSchema = z
  .object({
    kind: z
      .enum(DAILY_RECORD_ATTACHMENT_KIND_VALUES)
      .describe('Attachment kind. Defaults to "image".')
      .optional(),
    objectKey: z
      .string()
      .max(500)
      .describe('Object storage key, stable across signed URL rotations.'),
    bucket: z.string().max(200).describe('Object storage bucket.').nullish(),
    provider: z
      .string()
      .max(50)
      .describe('Storage provider (e.g. tencent-cos, s3).')
      .nullish(),
    fileName: z.string().max(255).describe('Original file name.').nullish(),
    contentType: z.string().max(100).describe('MIME content type.').nullish(),
    sizeBytes: z
      .number()
      .int()
      .min(0)
      .max(50_000_000)
      .describe('File size in bytes.')
      .nullish(),
    width: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .describe('Image width in pixels.')
      .nullish(),
    height: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .describe('Image height in pixels.')
      .nullish(),
    publicUrl: z
      .string()
      .max(2000)
      .describe('Optional public or already-signed display URL.')
      .nullish(),
  })
  .strict();

/** Strongly typed attachment metadata entry of record create/update payloads. */
export type DailyRecordAttachmentInputDto = z.infer<
  typeof dailyRecordAttachmentInputSchema
>;

/**
 * Standard Schema (zod 4) for one `attachments` entry of daily-record read
 * responses (list/detail/create/update).
 *
 * Replaces the former `@ApiProperty` response class `DailyRecordAttachmentDto`.
 * The mapper always emits every key, so nullable storage columns surface as an
 * explicit `null` (no `.optional()`/`.default()` on the response side).
 */
export const dailyRecordAttachmentSchema = z.object({
  id: z.string().describe('Attachment id.'),
  kind: z.enum(DAILY_RECORD_ATTACHMENT_KIND_VALUES),
  objectKey: z.string().describe('Object storage key.'),
  bucket: z.string().describe('Object storage bucket.').nullable(),
  provider: z.string().describe('Storage provider.').nullable(),
  fileName: z.string().describe('Original file name.').nullable(),
  contentType: z.string().describe('MIME content type.').nullable(),
  sizeBytes: z.number().int().describe('File size in bytes.').nullable(),
  width: z.number().int().describe('Image width in pixels.').nullable(),
  height: z.number().int().describe('Image height in pixels.').nullable(),
  publicUrl: z.string().describe('Public or signed display URL.').nullable(),
  createdAt: z.string().describe('Created at (ISO 8601).'),
});

/** Strongly typed attachment metadata of daily-record read responses. */
export type DailyRecordAttachmentDto = z.infer<
  typeof dailyRecordAttachmentSchema
>;
