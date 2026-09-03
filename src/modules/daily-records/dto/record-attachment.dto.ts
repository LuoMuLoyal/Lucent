import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class DailyRecordAttachmentDto {
  @ApiProperty({ description: 'Attachment id.' })
  id!: string;

  @ApiProperty({
    enum: DailyRecordAttachmentKind,
    enumName: 'DailyRecordAttachmentKind',
  })
  kind!: DailyRecordAttachmentKind;

  @ApiProperty({ description: 'Object storage key.' })
  objectKey!: string;

  @ApiPropertyOptional({
    description: 'Object storage bucket.',
    type: String,
    nullable: true,
  })
  bucket!: string | null;

  @ApiPropertyOptional({
    description: 'Storage provider.',
    type: String,
    nullable: true,
  })
  provider!: string | null;

  @ApiPropertyOptional({
    description: 'Original file name.',
    type: String,
    nullable: true,
  })
  fileName!: string | null;

  @ApiPropertyOptional({
    description: 'MIME content type.',
    type: String,
    nullable: true,
  })
  contentType!: string | null;

  @ApiPropertyOptional({
    description: 'File size in bytes.',
    type: Number,
    nullable: true,
  })
  sizeBytes!: number | null;

  @ApiPropertyOptional({
    description: 'Image width in pixels.',
    type: Number,
    nullable: true,
  })
  width!: number | null;

  @ApiPropertyOptional({
    description: 'Image height in pixels.',
    type: Number,
    nullable: true,
  })
  height!: number | null;

  @ApiPropertyOptional({
    description: 'Public or signed display URL.',
    type: String,
    nullable: true,
  })
  publicUrl!: string | null;

  @ApiProperty({ description: 'Created at (ISO 8601).' })
  createdAt!: string;
}
