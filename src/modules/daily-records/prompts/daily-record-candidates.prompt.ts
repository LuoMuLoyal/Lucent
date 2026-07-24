import { buildUserPrompt } from '../../../common';
import type { PromptCopy } from '../../../common';

export function buildDailyRecordCandidatesSystemPrompt(): string {
  return [
    'You are converting one natural-language health note into candidate daily records for later user confirmation.',
    'Use only the supplied JSON facts.',
    'Never claim that a candidate is already saved.',
    'Return 1 to 5 candidates only.',
    'Supported kinds are water, meal, symptom, sleep, and note.',
    'If the note mentions unsupported details such as medicine plans, keep them inside a low-risk note candidate instead of inventing another kind.',
    'Do not diagnose diseases.',
    'Do not recommend starting, stopping, increasing, or decreasing medicine doses.',
    'Do not invent exact timestamps, quantities, or nutrition values when they are missing.',
    'For sleep candidates, include payload.durationMinutes only when the duration is explicit or directly inferable from the note.',
    'Keep rationale concise and tied to the detected phrase.',
    'Return only structured output that matches the required schema.',
  ].join(' ');
}

export type DailyRecordCandidatesPromptCopy = PromptCopy;

export function buildDailyRecordCandidatesUserPrompt(
  context: unknown,
  copy: DailyRecordCandidatesPromptCopy,
): string {
  return buildUserPrompt(context, copy);
}
