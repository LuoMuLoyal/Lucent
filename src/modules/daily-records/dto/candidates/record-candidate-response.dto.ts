import { z } from 'zod';

import { DAILY_RECORD_CANDIDATE_KINDS } from '../../schemas/daily-record-candidates.schema.js';

export type DailyRecordCandidateKind =
  (typeof DAILY_RECORD_CANDIDATE_KINDS)[number];

/**
 * Standard Schema (zod 4) for one AI-generated candidate item of
 * `POST /daily-records/candidate-records/generate`.
 *
 * Replaces the former `@ApiProperty` class `DailyRecordCandidateItemDto`
 * (module-internal, not exported). Every key is always emitted; nullable
 * fields surface as an explicit `null`.
 */
const dailyRecordCandidateItemSchema = z.object({
  kind: z.enum(DAILY_RECORD_CANDIDATE_KINDS),
  occurredAt: z
    .string()
    .describe('Candidate occurred date in YYYY-MM-DD format.'),
  title: z.string().describe('Short candidate title.').nullable(),
  value: z.string().describe('Candidate measured value.').nullable(),
  unit: z.string().describe('Candidate unit.').nullable(),
  note: z.string().describe('Candidate free-text note.').nullable(),
  payload: z
    .record(z.string(), z.unknown())
    .describe(
      'Structured candidate payload. For sleep, this may include durationMinutes and optional timing hints.',
    )
    .nullable(),
  rationale: z
    .string()
    .describe(
      'Human-readable reason showing which phrase or fact led to this candidate.',
    ),
});

/**
 * Standard Schema (zod 4) for the generate-candidates payload
 * (`locale` + `generatedAt` + `confirmationHint` + candidate `items`).
 *
 * Replaces the former `@ApiProperty` data class `DailyRecordCandidateDataDto`.
 */
export const dailyRecordCandidateDataSchema = z.object({
  locale: z.string().describe('Normalized parse locale.'),
  generatedAt: z
    .string()
    .describe('ISO-8601 timestamp when candidates were generated.'),
  confirmationHint: z
    .string()
    .describe(
      'Short UI hint telling the client that these are candidates, not saved records.',
    ),
  items: z.array(dailyRecordCandidateItemSchema),
});

/** Strongly typed generate-candidates payload (shared alias). */
export type DailyRecordCandidateDataDto = z.infer<
  typeof dailyRecordCandidateDataSchema
>;

/**
 * Standard Schema (zod 4) for the `POST /daily-records/candidate-records/
 * generate` (200) response body.
 *
 * Replaces the former response class `DailyRecordCandidateResponseDto` (which
 * extended `DailyRecordCandidateDataDto` without adding fields).
 */
export const dailyRecordCandidateResponseSchema =
  dailyRecordCandidateDataSchema;

/** Strongly typed response body of the generate-candidates endpoint. */
export type DailyRecordCandidateResponseDto = z.infer<
  typeof dailyRecordCandidateResponseSchema
>;

/** Backwards-compatible alias used by the candidates orchestration layer. */
export type DailyRecordCandidateData = DailyRecordCandidateDataDto;
