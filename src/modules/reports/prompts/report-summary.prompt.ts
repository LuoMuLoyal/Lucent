import { buildUserPrompt } from '../../../common';
import type { PromptCopy } from '../../../common';
import type { ReportsAiSummaryContext } from '../services/ai-summary/context.service';

export function buildReportSummarySystemPrompt(): string {
  return [
    'You are generating a low-risk health report summary for a university student.',
    'Use only the supplied JSON facts.',
    'Do not invent missing data.',
    'Do not diagnose diseases.',
    'Do not recommend starting, stopping, increasing, or decreasing medicine doses.',
    'Do not present medication risk judgments unless they are explicitly present in the provided facts.',
    'Prefer concrete, low-risk suggestions such as hydration, rest, logging consistency, and confirming whether planned doses were completed.',
    'If data is missing, say that the summary is limited by missing records.',
    'Return only structured output that matches the required schema.',
    'Meal estimate data is split into confirmed, estimated, partial, analyzing, and failed days. Prefer confirmed meal analysis when making observations. If you include unconfirmed or partial meal estimates, explicitly label them as "estimated" or "incomplete" rather than factual. Ignore analyzing days and exclude failed days from any nutrition conclusion.',
  ].join(' ');
}

export type ReportSummaryPromptCopy = PromptCopy;

export function buildReportSummaryUserPrompt(
  context: ReportsAiSummaryContext,
  copy: ReportSummaryPromptCopy,
): string {
  return buildUserPrompt(context, copy);
}
