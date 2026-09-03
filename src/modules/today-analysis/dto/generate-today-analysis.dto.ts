import { z } from 'zod';

/**
 * Standard Schema (zod 4) for the JSON body of the manual Today-analysis
 * generation endpoints (POST `/today-analysis/refresh`, `/generate`,
 * `/generate/async`, `/generate/stream`).
 *
 * Replaces the former class-validator DTO:
 * - `@IsOptional` → `.optional()` (absent key stays `undefined`);
 * - `@IsDateString` → `z.iso.date()` — the contract date is a calendar day
 *   in YYYY-MM-DD (see the old `example: '2026-06-12'`) and the resolution
 *   layer treats it as a date-only key, so full ISO datetimes that
 *   class-validator's permissive `isISO8601` accepted are now rejected;
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected) — the migration default is stripping,
 *   but these endpoints keep the historical strict posture.
 */
export const generateTodayAnalysisSchema = z
  .object({
    date: z.iso
      .date()
      .describe(
        'Target date in YYYY-MM-DD format. Defaults to backend current day when omitted.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed body of the Today-analysis generation endpoints. */
export type GenerateTodayAnalysisDto = z.infer<
  typeof generateTodayAnalysisSchema
>;
