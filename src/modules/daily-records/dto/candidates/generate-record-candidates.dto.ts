import { z } from 'zod';

/**
 * Standard Schema (zod 4) for
 * `POST /daily-records/candidate-records/generate`.
 *
 * Replaces the former class-validator `GenerateDailyRecordCandidatesDto`:
 * - `@IsString`/`@MinLength`/`@MaxLength` → `z.string().min/max(...)`;
 * - `@IsDateString` (YYYY-MM-DD docs) → `z.iso.date()`;
 * - the global `forbidNonWhitelisted` posture is preserved with `.strict()`.
 */
export const generateDailyRecordCandidatesSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        'Natural-language note to be parsed into candidate daily records.',
      ),
    occurredAt: z.iso
      .date()
      .describe(
        'Wake date in YYYY-MM-DD format used as the candidate record date baseline.',
      ),
    timezone: z
      .string()
      .max(100)
      .describe(
        'Optional user timezone hint used only for interpretation wording. No server timezone conversion is persisted.',
      )
      .optional(),
  })
  .strict();

/** Strongly typed create body of candidate-record generation. */
export type GenerateDailyRecordCandidatesDto = z.infer<
  typeof generateDailyRecordCandidatesSchema
>;
