import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  SuggestionType,
  TriggerType,
  SuggestionLifecycleState,
  SuggestionCardTone,
  SuggestionConfidence,
  SuggestionFeedback,
} from '../types/suggestion.types';

/** Evidence item shown on a suggestion card. */
export class EvidenceItemDto {
  @ApiProperty({
    enum: ['record', 'reminder', 'risk_check', 'trend', 'profile', 'baseline'],
  })
  kind!: string;

  @ApiProperty({ description: 'Human-readable label' })
  label!: string;

  @ApiProperty({ description: 'Human-readable value' })
  value!: string;

  @ApiPropertyOptional({ description: 'Related record id for navigation' })
  recordId?: string | undefined;

  @ApiPropertyOptional({ description: 'Related medicine id for navigation' })
  medicineId?: string | undefined;
}

/** Action that the user can take from a suggestion card. */
export class SuggestionActionDto {
  @ApiProperty({ description: 'Unique action id' })
  actionId!: string;

  @ApiProperty({ description: 'Localized action label' })
  label!: string;

  @ApiProperty({ description: 'Deep-link route for navigation' })
  route!: string;

  @ApiProperty({ description: 'Whether authentication is required' })
  authRequired!: boolean;
}

/** A single suggestion card in the API response. */
export class SuggestionItemDto {
  @ApiProperty({ description: 'Unique suggestion id' })
  id!: string;

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

  @ApiProperty({
    description: 'Visual tone hint',
    enum: ['urgent', 'warning', 'emphasis', 'soft', 'neutral'],
  })
  cardTone!: SuggestionCardTone;

  @ApiProperty({ description: 'Icon identifier for the frontend' })
  icon!: string;

  @ApiProperty({ description: 'Localized short title' })
  title!: string;

  @ApiProperty({ description: 'Why this suggestion appeared' })
  reason!: string;

  @ApiProperty({ type: () => [EvidenceItemDto], description: 'Evidence items' })
  evidence!: EvidenceItemDto[];

  @ApiProperty({ description: 'Medical disclaimer / boundary text' })
  boundary!: string;

  @ApiProperty({
    type: () => SuggestionActionDto,
    description: 'Primary action',
  })
  primaryAction!: SuggestionActionDto;

  @ApiPropertyOptional({
    type: () => [SuggestionActionDto],
    description: 'Secondary actions',
  })
  secondaryActions?: SuggestionActionDto[] | undefined;

  @ApiProperty({
    description: 'Confidence level',
    enum: ['high', 'medium', 'low'],
  })
  confidence!: SuggestionConfidence;

  @ApiProperty({ description: 'Rule identifier for auditability' })
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

  @ApiPropertyOptional({
    description: 'Whether this card can trigger a notification',
  })
  notificationEligible?: boolean | undefined;

  @ApiPropertyOptional({
    type: () => [String],
    description: 'Available feedback options for this card',
    enum: ['accepted', 'later', 'not_applicable', 'suppress'],
  })
  feedbackOptions?: SuggestionFeedback[] | undefined;

  @ApiPropertyOptional({ description: 'Sub-type for rendering variety' })
  subtype?: string | undefined;
}
