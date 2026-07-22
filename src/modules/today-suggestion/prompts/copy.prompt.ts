/**
 * Prompts for AI-powered suggestion copy generation.
 */

import type {
  CopyGenerationContext,
  CopyPromptCopy,
} from '../types/copy-generation.types';

export interface CopyGenerationOptions {
  tone?: 'gentle' | 'direct' | 'professional';
}

/**
 * Builds the system prompt for copy generation.
 */
export function buildCopySystemPrompt(options: CopyGenerationOptions): string {
  const { tone = 'gentle' } = options;

  const toneInstructions: Record<string, string> = {
    gentle:
      'Use a warm, supportive, and non-judgmental tone. Avoid alarmist language.',
    direct:
      'Be clear and concise, but still respectful. Get to the point quickly.',
    professional:
      'Use clinical precision with empathy. Suitable for health-related content.',
  };
  const toneKey = tone as string;

  return `You are a health assistant copywriter specializing in personalized wellness suggestions.

## Task
Generate suggestion card copy based on the provided template key and parameters. The copy should feel natural, helpful, and appropriately cautious about health claims.

## Language
Generate ALL output in the locale specified in the user context JSON.

## Tone
${toneInstructions[toneKey] ?? toneInstructions['gentle'] ?? 'gentle'}

## Output Format
Respond with a JSON object containing:
- title: string (max 20 characters, action-oriented, no punctuation at end)
- reason: string (1-2 sentences explaining the situation, include specific numbers from params)
- boundary: string (1 sentence clarifying limitations, always include a disclaimer that this is algorithmic advice, not medical diagnosis)
- actionLabel: string (max 6 characters, verb-first, imperative mood)

## Rules
1. Title should be concise and describe the situation
2. Reason should incorporate the provided parameters naturally
3. Boundary must acknowledge that this is algorithmic advice, not medical diagnosis
4. ActionLabel should be a clear call-to-action
5. Never make absolute medical claims — use hedging language (e.g., "may", "suggests", "could help")
6. For medication reminders, emphasize user agency (e.g., "please confirm" rather than imperative commands)
7. For trend alerts, use cautious language (e.g., "shows a trend" rather than "diagnosed")
8. Reason should reference specific items from the evidence array when available
9. For high confidence suggestions, use more direct language; for low confidence, hedge appropriately
10. suggestionType indicates the card's priority: confirmed_risk/compliance are urgent, behavior_advice is encouraging, coverage is informational

## Templates Reference
- coverage.profile.incomplete: Profile missing fields
- coverage.record.empty_today: No records today
- missed.dose.pending: Overdue medication dose
- water.behind.target: Water intake below target
- sleep.shortfall: Sleep duration insufficient
- mood.sleep.correlation: Low mood + poor sleep correlation
- caffeine.sleep.correlation: Caffeine + declining sleep correlation
- symptom.deteriorating.trend: Worsening symptom trend`;
}

/**
 * Builds the user prompt for copy generation.
 *
 * Passes the full context (evidence, confidence, suggestionType, etc.)
 * so the LLM can produce more grounded copy.
 */
export function buildCopyUserPrompt(
  context: CopyGenerationContext,
  copy: CopyPromptCopy,
): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.constraints,
    copy.factsLabel,
    JSON.stringify(
      {
        templateKey: context.templateKey,
        suggestionType: context.suggestionType,
        confidence: context.confidence,
        ruleId: context.ruleId,
        ...(context.subtype != null ? { subtype: context.subtype } : {}),
        params: context.params,
        evidence: context.evidence,
      },
      null,
      2,
    ),
  ].join('\n');
}
