import { z } from 'zod';
import { isoDateOrDatetimeSchema } from '../../../common/validators/iso-datetime.schema.js';

/**
 * Max INCLUSIVE UTC calendar days for one funnel query window
 * (dateFrom..dateTo). Mirrors the existing product cap
 * `CLINIC_SUMMARY_MAX_RANGE_DAYS` and the legacy last_30_days report range:
 * dateFrom == dateTo is a valid single-day window; a span of 31 inclusive
 * days is rejected with 400 by the service.
 */
export const MAX_FUNNEL_RANGE_DAYS = 30;

/**
 * ISO 8601 date (YYYY-MM-DD) or datetime with a UTC offset (Z or ±HH:MM) —
 * the shapes the previous `@IsDateString` (validator loose ISO 8601)
 * accepted for the tested contract. Datetimes without an offset are rejected
 * (no instant semantics). Implemented as a refined string so the OpenAPI
 * conversion stays a plain `string` (a `z.iso.date().or(z.iso.datetime())`
 * union would break the client generator).
 */
const funnelDateSchema = isoDateOrDatetimeSchema();

/**
 * Standard Schema (zod 4) for the admin funnel aggregation query params.
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent keys stay `undefined`);
 * - `@IsDateString` → `z.iso.date().or(z.iso.datetime(...))` (both params
 *   stay optional together — when neither is given the service falls back to
 *   the default window);
 * - `.strict()` preserves the global `forbidNonWhitelisted` rejection of
 *   unknown query keys.
 */
export const productFunnelQuerySchema = z
  .object({
    dateFrom: funnelDateSchema
      .describe(
        'Window start (inclusive), ISO 8601 date (YYYY-MM-DD) or datetime; the UTC calendar day is used.',
      )
      .optional(),
    dateTo: funnelDateSchema
      .describe(
        'Window end (inclusive), ISO 8601 date (YYYY-MM-DD) or datetime; the UTC calendar day is used.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed query object of `GET /product-events/funnel`. */
export type FunnelQueryDto = z.infer<typeof productFunnelQuerySchema>;
