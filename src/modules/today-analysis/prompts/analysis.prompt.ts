import { buildUserPrompt } from '../../../common';
import type { PromptCopy } from '../../../common';
import type { TodayAnalysisContext } from '../services/context.service';

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
    'Meal records in recentRecords may have titles like "饮食已确认：..." or "饮食估算中：...". Treat "饮食估算中" as an unconfirmed estimate. Treat notes containing "部分估算" as low-confidence partial context. If a meal record shows "饮食分析缺失" or "analysis_failed", treat it as missing meal-analysis data rather than confirmed absence of food.',
  ].join(' ');
}

export type TodayAnalysisPromptCopy = PromptCopy;

export function buildTodayAnalysisUserPrompt(
  context: TodayAnalysisContext,
  copy: TodayAnalysisPromptCopy,
): string {
  return buildUserPrompt(context, copy);
}
