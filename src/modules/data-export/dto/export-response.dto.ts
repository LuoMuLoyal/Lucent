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

/**
 * Standard Schema (zod 4) for a single data export request resource (the
 * `POST /data-export-requests` result and the payload of
 * `GET /data-export-requests/latest`).
 *
 * Replaces the former `DataExportRequestDataDto` response class. Response
 * schemas intentionally carry no `.strict()` / `.default()` so outbound
 * parsing tolerates whatever the service layer produces.
 */
export const dataExportRequestDataSchema = z.object({
  id: z.string().describe('Unique request identifier.'),
  kind: z.enum(DATA_EXPORT_KINDS),
  format: z.enum(DATA_EXPORT_FORMATS),
  range: z.enum(DATA_EXPORT_RANGES),
  status: z.enum(DATA_EXPORT_STATUSES),
  requestedAt: z
    .string()
    .describe('ISO-8601 timestamp when the request was created.'),
  completedAt: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

/** Strongly typed single data export request resource. */
export type DataExportRequestDataDto = z.infer<
  typeof dataExportRequestDataSchema
>;

/**
 * Standard Schema (zod 4) for `GET /data-export-requests/latest`, which
 * resolves to a request resource or `null` when no request exists yet.
 */
export const dataExportLatestResponseSchema =
  dataExportRequestDataSchema.nullable();

/** Strongly typed result of the latest-request lookup. */
export type DataExportLatestResponseDto = z.infer<
  typeof dataExportLatestResponseSchema
>;

/** Backwards-compatible response alias kept for the former DTO class name. */
export type DataExportRequestResponseDto = DataExportRequestDataDto;
