import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import {
  SuggestionConfidence,
  SuggestionLifecycleState,
  SuggestionType,
  TriggerType,
} from '../types/suggestion.types.js';

/**
 * Standard Schema (zod 4) for a single suggestion history item returned by
 * `GET /today/suggestions/history`. Replaces the former
 * `SuggestionHistoryItemDto` response class.
 */
export const suggestionHistoryItemSchema = z.object({
  id: z.string().describe('Unique suggestion id'),
  date: z.string().describe('Date (YYYY-MM-DD)'),
  type: z.enum(SuggestionType).describe('Suggestion type'),
  title: z.string().describe('Localized short title'),
  reason: z.string().describe('Why this suggestion appeared'),
  ruleId: z.string().describe('Rule identifier'),
  ruleVersion: z.string().describe('Rule version'),
  triggerType: z.enum(TriggerType).describe('Trigger type'),
  lifecycleState: z.enum(SuggestionLifecycleState).describe('Lifecycle state'),
  confidence: z.enum(SuggestionConfidence).describe('Confidence level'),
  subtype: z.string().optional().describe('Sub-type'),
  feedback: z.string().optional().describe('User feedback, if any'),
  feedbackAt: z.string().optional().describe('When feedback was recorded'),
  generatedAt: z.string().describe('When the suggestion was generated'),
  expiredAt: z.string().optional().describe('When the suggestion was expired'),
});

/** Strongly typed single suggestion history item. */
export type SuggestionHistoryItemDto = z.infer<
  typeof suggestionHistoryItemSchema
>;

/** Query parameters for GET /today/suggestions/history. */
export class SuggestionHistoryQueryDto {
  @ApiProperty({
    description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.',
    required: false,
  })
  startDate?: string;

  @ApiProperty({
    description: 'End date (YYYY-MM-DD). Defaults to today.',
    required: false,
  })
  endDate?: string;

  @ApiProperty({
    description: 'Filter by lifecycle state',
    enum: ['generated', 'active', 'fading', 'expired', 'dismissed'],
    required: false,
  })
  lifecycleState?: string | undefined;

  @ApiProperty({
    description: 'Filter by suggestion type',
    enum: [
      'confirmed_risk',
      'compliance',
      'trend',
      'behavior_advice',
      'coverage',
    ],
    required: false,
  })
  type?: string | undefined;

  @ApiProperty({
    description: 'Maximum number of items to return (default 100, max 500)',
    required: false,
  })
  limit?: number | undefined;
}

/**
 * Standard Schema (zod 4) for the data payload of
 * `GET /today/suggestions/history`. Replaces the former
 * `SuggestionHistoryDataDto` response class.
 */
export const suggestionHistoryDataSchema = z.object({
  items: z
    .array(suggestionHistoryItemSchema)
    .describe('Suggestion history items'),
  total: z.number().describe('Total count of matching items'),
  startDate: z.string().describe('Start date used for the query'),
  endDate: z.string().describe('End date used for the query'),
});

/** Strongly typed suggestion history data payload. */
export type SuggestionHistoryDataDto = z.infer<
  typeof suggestionHistoryDataSchema
>;

/**
 * Backwards-compatible response alias for `GET /today/suggestions/history`;
 * identical to {@link SuggestionHistoryDataDto} on the wire.
 */
export type SuggestionHistoryResponseDto = SuggestionHistoryDataDto;
