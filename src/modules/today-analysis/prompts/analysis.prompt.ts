import { buildUserPrompt } from '../../../common/index.js';
import type { PromptCopy } from '../../../common/index.js';
import type { TodayAnalysisContext } from '../services/pipeline/context.service.js';

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
    'Meal records in recentRecords appear as "饮食分析" with a note carrying the recognized dishes, the kcal interval, and the most important findings. If a meal record shows "饮食分析缺失", treat it as missing meal-analysis data rather than confirmed absence of food.',
  ].join(' ');
}

export type TodayAnalysisPromptCopy = PromptCopy;

export function buildTodayAnalysisUserPrompt(
  context: TodayAnalysisContext,
  copy: TodayAnalysisPromptCopy,
): string {
  return buildUserPrompt(context, copy);
}
