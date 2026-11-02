import { z } from 'zod';
import { dateOnlySchema } from '../../../../../../common/validators/iso-datetime.schema.js';

/**
 * Standard Schema (zod 4) for
 * `POST /daily-records/candidate-records/generate`.
 *
 * Replaces the former class-validator `GenerateDailyRecordCandidatesDto`:
 * - `@IsString`/`@MinLength`/`@MaxLength` → `z.string().min/max(...)`;
 * - `@IsDateString` (YYYY-MM-DD docs) → `dateOnlySchema()`;
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
      )
      .meta({
        example:
          'Slept about 7 hours and had a mild headache in the afternoon.',
      }),
    occurredAt: dateOnlySchema()
      .describe(
        'Wake date in YYYY-MM-DD format used as the candidate record date baseline.',
      )
      .meta({ example: '2026-06-04' }),
    timezone: z
      .string()
      .max(100)
      .describe(
        'Optional user timezone hint used only for interpretation wording. No server timezone conversion is persisted.',
      )
      .meta({ example: 'Asia/Shanghai' })
      .optional(),
  })
  .strict();

/** Strongly typed create body of candidate-record generation. */
export type GenerateDailyRecordCandidatesDto = z.infer<
  typeof generateDailyRecordCandidatesSchema
>;
