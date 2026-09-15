import { buildUserPrompt } from '../../../common/index.js';
import type { PromptCopy } from '../../../common/index.js';
import type { ReportsAiSummaryContext } from '../services/ai-summary/context.service.js';

export function buildReportSummarySystemPrompt(): string {
  return [
    'You are generating a low-risk longitudinal health insight for a university student.',
    'Use ONLY the supplied JSON facts.',
    'Do not invent missing data.',
    'Do not diagnose diseases.',
    'Do not recommend starting, stopping, increasing, or decreasing medicine doses.',
    'OUTPUT RULES (strict):',
    '1. If ALL three dimensions (medication, water, sleep) have insufficient data',
    '   (trackedDays === 0 for all), you MUST abstain:',
    '   - Set summary to the fixed abstain string from the prompt copy.',
    '   - Set observedPattern and lowRiskAction to null.',
    '2. You may include AT MOST ONE observedPattern.',
    '   It must be backed by a concrete source field from the facts.',
    '   Do not synthesize patterns that are not present in the data.',
    '3. You may include AT MOST ONE lowRiskAction.',
    '   It must be a concrete, low-risk suggestion (hydration, rest,',
    '   logging consistency, confirming planned doses).',
    '   Never suggest medication changes.',
    '4. coverage must mirror the trackedDays / totalDays from the facts.',
    '5. Do not generate generalized prose or narrative.',
    '6. Return only structured output that matches the required schema.',
    '7. Meal analysis data is split into analyzed, analyzing, and failed days.',
    '   Base nutrition observations on analyzed days only. Ignore analyzing days',
    '   and exclude failed days from any nutrition conclusion. Meal energy is an',
    '   interval, never a single value: quote it as a range and never as precise.',
  ].join(' ');
}

export type ReportSummaryPromptCopy = PromptCopy;

export function buildReportSummaryUserPrompt(
  context: ReportsAiSummaryContext,
  copy: ReportSummaryPromptCopy,
): string {
  return buildUserPrompt(context, copy);
}
