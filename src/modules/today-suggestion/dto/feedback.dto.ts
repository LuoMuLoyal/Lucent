import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { SuggestionFeedback } from '../types/suggestion.types.js';

const FEEDBACK_VALUES = [
  'accepted',
  'later',
  'not_applicable',
  'suppress',
] as const;

/**
 * Standard Schema (zod 4) for the JSON body of
 * `POST /today/suggestions/:id/feedback`.
 *
 * Replaces the former class-validator DTO:
 * - `@IsIn(FEEDBACK_VALUES)` → `z.enum(SuggestionFeedback)` — zod v4 merged
 *   `nativeEnum` into `z.enum` (native TS enums are accepted directly); the
 *   enum carries the same values as `FEEDBACK_VALUES` (kept below for the
 *   response/documentation DTOs);
 * - the global `forbidNonWhitelisted` behaviour is preserved with `.strict()`
 *   (unknown body keys are rejected) — the migration default is stripping,
 *   but this endpoint keeps the historical strict posture.
 */
export const suggestionFeedbackSchema = z
  .object({
    feedback: z
      .enum(SuggestionFeedback, {
        message: 'must be one of accepted, later, not_applicable, suppress',
      })
      .describe('User feedback for the suggestion'),
  })
  .strict();

/** Strongly typed body of `POST /today/suggestions/:id/feedback`. */
export type SuggestionFeedbackDto = z.infer<typeof suggestionFeedbackSchema>;

export class SuggestionFeedbackData {
  @ApiProperty()
  suggestionId!: string;

  @ApiProperty({ enum: FEEDBACK_VALUES })
  feedback!: SuggestionFeedback;

  @ApiProperty({
    description: 'Effect applied by the feedback engine',
    enum: ['boosted_type', 'delayed_until', 'suppressed_type', 'noted'],
  })
  appliedEffect!: string;

  @ApiPropertyOptional({
    description: 'When the suppression expires (if applicable)',
  })
  expiresAt?: string;
}

/** Envelope response for POST /today/suggestions/:id/feedback. */
export class SuggestionFeedbackResponse extends SuggestionFeedbackData {}
