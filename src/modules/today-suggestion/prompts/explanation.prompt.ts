import type {
  SuggestionType,
  TriggerType,
  SuggestionConfidence,
} from '../types/suggestion.types';
import type { EvidenceItem } from '../types/signal.types';

/**
 * Context passed to the LLM for generating an explanation.
 * Contains only the data the LLM needs — no user PII beyond what's
 * already in the suggestion card.
 */
export interface ExplanationContext {
  suggestionType: SuggestionType;
  triggerType: TriggerType;
  confidence: SuggestionConfidence;
  title: string;
  ruleId: string;
  subtype?: string;
  evidence: EvidenceItem[];
  /** The original rule-generated reason, for reference. */
  originalReason: string;
  /** The original rule-generated boundary, for reference. */
  originalBoundary: string;
}

/**
 * Prompt copy for localized instructions to the LLM.
 */
export interface ExplanationPromptCopy {
  userIntro: string;
  tone: string;
  constraints: string;
  factsLabel: string;
}

/**
 * Builds the system prompt for the AI explanation generator.
 *
 * Core principles (aligned with Product_AI_Design):
 * - Rule-first, AI only explains — never creates or overrides suggestions.
 * - All output must be grounded in the provided evidence array.
 * - Medical safety: never diagnose, prescribe, or recommend dose changes.
 */
export function buildExplanationSystemPrompt(): string {
  return [
    'You are generating a natural-language explanation for a health suggestion card.',
    'The suggestion was already produced by a rule engine — your job is only to make the reason and boundary text more natural and helpful.',
    'Use ONLY the supplied evidence items. Do not invent data or reference records that are not in the evidence array.',
    'Do not diagnose diseases or medical conditions.',
    'Do not recommend starting, stopping, increasing, or decreasing medicine doses.',
    'Do not present medication risk judgments unless they are explicitly present in the provided evidence.',
    'Prefer concrete, low-risk language such as hydration, rest, logging, and checking whether a planned dose was already taken.',
    'If evidence is insufficient, say that the explanation is limited by available data.',
    'Return only structured output that matches the required schema.',
  ].join(' ');
}

/**
 * Builds the user prompt containing the suggestion context.
 */
export function buildExplanationUserPrompt(
  context: ExplanationContext,
  copy: ExplanationPromptCopy,
): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.constraints,
    copy.factsLabel,
    JSON.stringify(context),
  ].join('\n');
}
