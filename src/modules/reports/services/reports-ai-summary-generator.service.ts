import { Injectable } from '@nestjs/common';
import { BaseAiGeneratorService } from '../../../common/ai/base-ai-generator.service';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';
import {
  buildReportSummarySystemPrompt,
  buildReportSummaryUserPrompt,
  type ReportSummaryPromptCopy,
} from '../prompts/report-summary.prompt';
import {
  reportSummarySchema,
  type ReportSummaryStructuredOutput,
} from '../schemas/report-summary.schema';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';

@Injectable()
export class ReportsAiSummaryGeneratorService extends BaseAiGeneratorService<
  ReportsAiSummaryContext,
  ReportSummaryPromptCopy,
  ReportSummaryStructuredOutput
> {
  protected readonly schema = reportSummarySchema;
  protected readonly modelRole = 'analysis';
  protected readonly options = {
    toolName: 'ReportSummary',
    streamName: 'Report summary',
  } as const;

  public constructor(llmRuntimeService: LlmRuntimeService) {
    super(llmRuntimeService);
  }

  protected buildSystemPrompt(): string {
    return buildReportSummarySystemPrompt();
  }

  protected buildUserPrompt(
    context: ReportsAiSummaryContext,
    promptCopy: ReportSummaryPromptCopy,
  ): string {
    return buildReportSummaryUserPrompt(context, promptCopy);
  }
}
