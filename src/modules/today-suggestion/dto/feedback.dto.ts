import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { SuggestionFeedback } from '../types/suggestion.types.js';

const FEEDBACK_VALUES = [
  'accepted',
  'later',
  'not_applicable',
  'suppress',
] as const;

export class SuggestionFeedbackDto {
  @ApiProperty({
    description: 'User feedback for the suggestion',
    enum: FEEDBACK_VALUES,
  })
  @IsIn(FEEDBACK_VALUES)
  feedback!: SuggestionFeedback;
}

export class SuggestionFeedbackDataDto {
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
export class SuggestionFeedbackResponseDto extends SuggestionFeedbackDataDto {}
