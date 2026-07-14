import { z } from 'zod';

export const DAILY_RECORD_CANDIDATE_KINDS = [
  'water',
  'meal',
  'symptom',
  'note',
  'sleep',
] as const;

export const sleepPayloadSchema = z
  .object({
    durationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60),
    startAt: z.iso.datetime().optional(),
    endAt: z.iso.datetime().optional(),
    quality: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const dailyRecordCandidateSchema = z.object({
  kind: z.enum(DAILY_RECORD_CANDIDATE_KINDS),
  occurredAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(200).nullable(),
  value: z.string().trim().min(1).max(100).nullable(),
  unit: z.string().trim().min(1).max(50).nullable(),
  note: z.string().trim().min(1).max(1000).nullable(),
  payload: z.union([
    sleepPayloadSchema,
    z.record(z.string(), z.unknown()),
    z.null(),
  ]),
  rationale: z.string().trim().min(1).max(160),
});

export const dailyRecordCandidatesSchema = z.object({
  items: z.array(dailyRecordCandidateSchema).min(1).max(5),
});

export type DailyRecordCandidateStructuredOutput = z.infer<
  typeof dailyRecordCandidatesSchema
>;
