import { z } from 'zod';
import {
  SuggestionConfidence,
  SuggestionFeedback,
  SuggestionLifecycleState,
  SuggestionType,
  TriggerType,
} from '../types/suggestion.types.js';

/**
 * Standard Schema (zod 4) for an evidence item shown on a suggestion card.
 * Replaces the former `EvidenceItemDto` response class.
 */
export const evidenceItemSchema = z.object({
  kind: z.string(),
  label: z.string().describe('Human-readable label'),
  value: z.string().describe('Human-readable value'),
  recordId: z.string().optional().describe('Related record id for navigation'),
  medicineId: z
    .string()
    .optional()
    .describe('Related medicine id for navigation'),
});

/** Strongly typed evidence item shown on a suggestion card. */
export type EvidenceItemDto = z.infer<typeof evidenceItemSchema>;

/**
 * Standard Schema (zod 4) for an action the user can take from a suggestion
 * card. Replaces the former `SuggestionActionDto` response class.
 */
export const suggestionActionSchema = z.object({
  actionId: z.string().describe('Unique action id'),
  label: z.string().describe('Localized action label'),
  route: z.string().describe('Deep-link route for navigation'),
  authRequired: z.boolean().describe('Whether authentication is required'),
});

/** Strongly typed suggestion card action. */
export type SuggestionActionDto = z.infer<typeof suggestionActionSchema>;

/**
 * Standard Schema (zod 4) for the observed-metric block attached to a
 * suggestion card. Replaces the former `SuggestionObservedMetricDto` response
 * class.
 */
export const suggestionObservedMetricSchema = z.object({
  value: z.number().nullable(),
  state: z.enum(['observed', 'unknown']),
  coverage: z.enum(['sufficient', 'partial', 'none']),
  sources: z.array(
    z.enum(['manual', 'health_platform', 'reminder_plan', 'derived']),
  ),
  observedCount: z.number(),
  expectedCount: z.number().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
});

/** Strongly typed observed-metric block of a suggestion card. */
export type SuggestionObservedMetricDto = z.infer<
  typeof suggestionObservedMetricSchema
>;

/**
 * Standard Schema (zod 4) for a single suggestion card in the API response.
 * Replaces the former `SuggestionItemDto` response class.
 */
export const suggestionItemSchema = z.object({
  id: z.string().describe('Unique suggestion id'),
  type: z.enum(SuggestionType).describe('Suggestion type'),
  cardTone: z
    .enum(['urgent', 'warning', 'emphasis', 'soft', 'neutral'])
    .describe('Visual tone hint'),
  icon: z.string().describe('Icon identifier for the frontend'),
  title: z.string().describe('Localized short title'),
  reason: z.string().describe('Why this suggestion appeared'),
  evidence: z.array(evidenceItemSchema).describe('Evidence items'),
  boundary: z.string().describe('Medical disclaimer / boundary text'),
  primaryAction: suggestionActionSchema.describe('Primary action'),
  secondaryActions: z
    .array(suggestionActionSchema)
    .optional()
    .describe('Secondary actions'),
  confidence: z.enum(SuggestionConfidence).describe('Confidence level'),
  ruleId: z.string().describe('Rule identifier for auditability'),
  ruleVersion: z.string().describe('Rule version'),
  triggerType: z.enum(TriggerType).describe('Trigger type'),
  lifecycleState: z.enum(SuggestionLifecycleState).describe('Lifecycle state'),
  notificationEligible: z
    .boolean()
    .optional()
    .describe('Whether this card can trigger a notification'),
  feedbackOptions: z
    .array(z.enum(SuggestionFeedback))
    .optional()
    .describe('Available feedback options for this card'),
  subtype: z.string().optional().describe('Sub-type for rendering variety'),
  observedMetric: suggestionObservedMetricSchema.optional(),
});

/** Strongly typed single suggestion card. */
export type SuggestionItemDto = z.infer<typeof suggestionItemSchema>;
