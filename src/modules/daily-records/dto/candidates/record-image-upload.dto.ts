import { ApiProperty } from '@nestjs/swagger';
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

export class DailyRecordImageUploadDto {
  @ApiProperty({ example: 'tencent-cos' })
  provider!: string;

  @ApiProperty({ example: 'lucent-test-bucket' })
  bucket!: string;

  @ApiProperty({
    example: 'daily-records/user-id/2026/06/06/generated-id.jpg',
  })
  objectKey!: string;

  @ApiProperty({
    description: 'Signed PUT URL for direct object storage upload.',
  })
  uploadUrl!: string;

  @ApiProperty({
    description: 'Headers that must be sent with the PUT upload.',
  })
  headers!: Record<string, string>;

  @ApiProperty({
    description:
      'Optional public/CDN URL when a public base URL is configured.',
  })
  publicUrl!: string | null;

  @ApiProperty({ description: 'Signed URL expiry timestamp (ISO 8601).' })
  expiresAt!: string;

  @ApiProperty({ description: 'Maximum accepted upload size in bytes.' })
  maxSizeBytes!: number;
}

export class DailyRecordImageUploadResponseDto extends DailyRecordImageUploadDto {}
