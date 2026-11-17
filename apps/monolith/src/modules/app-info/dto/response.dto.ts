import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the `GET /api/v1/public/app-info` response.
 *
 * Replaces the former `@ApiProperty` response class: each metadata field is
 * always present, holding a value or `null` when unset.
 */
export const appInfoResponseSchema = z.object({
  supportEmail: z.string().nullable(),
  minClientVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  downloadUrl: z.string().nullable(),
});

/** Strongly typed application metadata returned by `GET /public/app-info`. */
export type AppInfoResponseDto = z.infer<typeof appInfoResponseSchema>;

/** Backwards-compatible data alias kept for in-module references. */
export type AppInfoDataDto = AppInfoResponseDto;
