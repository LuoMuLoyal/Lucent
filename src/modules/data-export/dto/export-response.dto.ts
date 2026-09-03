import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const DATA_EXPORT_STATUSES = [
  'requested',
  'processing',
  'completed',
  'failed',
  'unavailable',
] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export const DATA_EXPORT_KINDS = ['hospital', 'monthly', 'print'] as const;
export type DataExportKind = (typeof DATA_EXPORT_KINDS)[number];

export const DATA_EXPORT_FORMATS = ['pdf'] as const;
export type DataExportFormat = (typeof DATA_EXPORT_FORMATS)[number];

export const DATA_EXPORT_RANGES = ['last_7_days', 'last_30_days'] as const;
export type DataExportRange = (typeof DATA_EXPORT_RANGES)[number];

/**
 * Standard Schema (zod 4) for `POST /data-export-requests` request body.
 *
 * Replaces the former class-validator request DTO:
 * - `@IsOptional` + `@IsIn(...)` → `z.enum(...).optional()`;
 * - `@IsString` + `@IsNotEmpty` on `password` → `z.string().min(1)` (empty
 *   string rejected, whitespace-only accepted — same as `IsNotEmpty`);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`.
 *
 * The response DTO classes below are pure response shapes and stay untouched.
 */
export const createDataExportRequestSchema = z
  .object({
    kind: z
      .enum(DATA_EXPORT_KINDS)
      .describe('Requested export kind.')
      .optional(),
    format: z
      .enum(DATA_EXPORT_FORMATS)
      .describe('Requested export format.')
      .optional(),
    range: z
      .enum(DATA_EXPORT_RANGES)
      .describe('Requested report range.')
      .optional(),
    password: z
      .string()
      .min(1, '当前密码不能为空')
      .describe('当前密码（敏感操作再认证用）'),
  })
  .strict();

/** Strongly typed request body of `POST /data-export-requests`. */
export type CreateDataExportRequestDto = z.infer<
  typeof createDataExportRequestSchema
>;

export class DataExportRequestDataDto {
  @ApiProperty({ description: 'Unique request identifier.' })
  id!: string;

  @ApiProperty({
    enum: DATA_EXPORT_KINDS,
    enumName: 'DataExportKind',
  })
  kind!: DataExportKind;

  @ApiProperty({
    enum: DATA_EXPORT_FORMATS,
    enumName: 'DataExportFormat',
  })
  format!: DataExportFormat;

  @ApiProperty({
    enum: DATA_EXPORT_RANGES,
    enumName: 'DataExportRange',
  })
  range!: DataExportRange;

  @ApiProperty({
    enum: DATA_EXPORT_STATUSES,
    enumName: 'DataExportStatus',
  })
  status!: DataExportStatus;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the request was created.',
  })
  requestedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  downloadUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fileName!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  fileSizeBytes!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  errorMessage!: string | null;
}

export class DataExportRequestResponseDto extends DataExportRequestDataDto {}

export class DataExportLatestResponseDto extends DataExportRequestDataDto {}
