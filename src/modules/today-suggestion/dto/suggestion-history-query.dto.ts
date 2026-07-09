import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  SuggestionType,
  TriggerType,
  SuggestionLifecycleState,
  SuggestionConfidence,
} from '../types/suggestion.types';

/** A single suggestion history item for the Report page. */
export class SuggestionHistoryItemDto {
  @ApiProperty({ description: 'Unique suggestion id' })
  id!: string;

  @ApiProperty({ description: 'Date (YYYY-MM-DD)' })
  date!: string;

  @ApiProperty({
    description: 'Suggestion type',
    enum: [
      'confirmed_risk',
      'compliance',
      'trend',
      'behavior_advice',
      'coverage',
    ],
  })
  type!: SuggestionType;

  @ApiProperty({ description: 'Localized short title' })
  title!: string;

  @ApiProperty({ description: 'Why this suggestion appeared' })
  reason!: string;

  @ApiProperty({ description: 'Rule identifier' })
  ruleId!: string;

  @ApiProperty({ description: 'Rule version' })
  ruleVersion!: string;

  @ApiProperty({ description: 'Trigger type', enum: ['event', 'timer'] })
  triggerType!: TriggerType;

  @ApiProperty({
    description: 'Lifecycle state',
    enum: ['generated', 'active', 'fading', 'expired', 'dismissed'],
  })
  lifecycleState!: SuggestionLifecycleState;

  @ApiProperty({
    description: 'Confidence level',
    enum: ['high', 'medium', 'low'],
  })
  confidence!: SuggestionConfidence;

  @ApiPropertyOptional({ description: 'Sub-type' })
  subtype?: string | undefined;

  @ApiPropertyOptional({
    description: 'User feedback, if any',
    enum: ['accepted', 'later', 'not_applicable', 'suppress'],
  })
  feedback?: string | undefined;

  @ApiPropertyOptional({ description: 'When feedback was recorded' })
  feedbackAt?: string | undefined;

  @ApiProperty({ description: 'When the suggestion was generated' })
  generatedAt!: string;

  @ApiPropertyOptional({ description: 'When the suggestion was expired' })
  expiredAt?: string | undefined;
}

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

/** Data payload for GET /today/suggestions/history. */
export class SuggestionHistoryDataDto {
  @ApiProperty({
    type: () => [SuggestionHistoryItemDto],
    description: 'Suggestion history items',
  })
  items!: SuggestionHistoryItemDto[];

  @ApiProperty({ description: 'Total count of matching items' })
  total!: number;

  @ApiProperty({ description: 'Start date used for the query' })
  startDate!: string;

  @ApiProperty({ description: 'End date used for the query' })
  endDate!: string;
}

/** Envelope response for GET /today/suggestions/history. */
export class SuggestionHistoryResponseDto {
  @ApiProperty({ example: 0 })
  code!: number;

  @ApiProperty({ example: '' })
  message!: string;

  @ApiProperty({ type: () => SuggestionHistoryDataDto })
  data!: SuggestionHistoryDataDto;
}
