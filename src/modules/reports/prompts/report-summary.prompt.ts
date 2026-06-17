import {
  buildAiUserPrompt,
  type AiPromptCopy,
} from '../../../common/ai/ai-copy';
import type { ReportsAiSummaryContext } from '../services/reports-ai-summary-context.service';

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
  ].join(' ');
}

export type ReportSummaryPromptCopy = AiPromptCopy;

export function buildReportSummaryUserPrompt(
  context: ReportsAiSummaryContext,
  copy: ReportSummaryPromptCopy,
): string {
  return buildAiUserPrompt(context, copy);
}
