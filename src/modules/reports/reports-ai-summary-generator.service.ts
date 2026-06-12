import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import {
  buildReportWeeklySummarySystemPrompt,
  buildReportWeeklySummaryUserPrompt,
  type ReportWeeklySummaryPromptCopy,
} from './prompts/report-weekly-summary.prompt';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';
import {
  reportWeeklySummarySchema,
  type ReportWeeklySummaryStructuredOutput,
} from './schemas/report-weekly-summary.schema';

@Injectable()
export class ReportsAiSummaryGeneratorService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('analysis');
  }

  async generate(
    context: ReportsAiSummaryContext,
    promptCopy: ReportWeeklySummaryPromptCopy,
  ): Promise<ReportWeeklySummaryStructuredOutput> {
    const model = this.llmRuntimeService
      .createChatModel('analysis', {
        timeout: 10_000,
        temperature: 0.2,
        maxRetries: 0,
      })
      .withStructuredOutput(reportWeeklySummarySchema, {
        name: 'ReportWeeklySummary',
        method: 'functionCalling',
        strict: true,
      });

    return model.invoke([
      new SystemMessage(buildReportWeeklySummarySystemPrompt()),
      new HumanMessage(buildReportWeeklySummaryUserPrompt(context, promptCopy)),
    ]);
  }
}
