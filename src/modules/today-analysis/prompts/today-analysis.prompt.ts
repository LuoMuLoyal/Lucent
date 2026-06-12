import type { TodayAnalysisContext } from '../today-analysis-context.service';

export function buildTodayAnalysisSystemPrompt(): string {
  return [
    'You are generating a low-risk daily health summary for a university student.',
    'Use only the supplied JSON facts.',
    'Do not invent missing data.',
    'Do not diagnose diseases.',
    'Do not recommend starting, stopping, increasing, or decreasing medicine doses.',
    'Do not present medication risk judgments unless they are explicitly present in the provided facts.',
    'Prefer concrete, low-risk suggestions such as hydration, rest, logging, and checking whether a planned dose was already taken.',
    'If data is missing, say that the summary is limited by missing records.',
    'Return only structured output that matches the required schema.',
  ].join(' ');
}

export interface TodayAnalysisPromptCopy {
  userIntro: string;
  tone: string;
  actionLabelHint: string;
  factsLabel: string;
}

export function buildTodayAnalysisUserPrompt(
  context: TodayAnalysisContext,
  copy: TodayAnalysisPromptCopy,
): string {
  return [
    copy.userIntro,
    copy.tone,
    copy.actionLabelHint,
    copy.factsLabel,
    JSON.stringify(context),
  ].join('\n');
}
