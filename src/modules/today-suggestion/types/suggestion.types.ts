/**
 * Core suggestion type enumeration.
 *
 * Aligns with `Product_Insights` — five card types only:
 * risk, compliance, trend, behavior advice, coverage.
 */
export enum SuggestionType {
  CONFIRMED_RISK = 'confirmed_risk',
  COMPLIANCE = 'compliance',
  TREND = 'trend',
  BEHAVIOR_ADVICE = 'behavior_advice',
  COVERAGE = 'coverage',
}

/** How a suggestion was triggered. */
export enum TriggerType {
  EVENT = 'event',
  TIMER = 'timer',
}

/** Lifecycle states for a suggestion card. */
export enum SuggestionLifecycleState {
  GENERATED = 'generated',
  ACTIVE = 'active',
  FADING = 'fading',
  EXPIRED = 'expired',
  DISMISSED = 'dismissed',
}

/** User feedback options for a suggestion card. */
export enum SuggestionFeedback {
  ACCEPTED = 'accepted',
  LATER = 'later',
  NOT_APPLICABLE = 'not_applicable',
  SUPPRESS = 'suppress',
}

/** Confidence level for a suggestion candidate. */
export enum SuggestionConfidence {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/** Visual tone hint for the frontend. */
export type SuggestionCardTone =
  | 'urgent'
  | 'warning'
  | 'emphasis'
  | 'soft'
  | 'neutral';
