import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import {
  buildReportSummarySystemPrompt,
  buildReportSummaryUserPrompt,
  type ReportSummaryPromptCopy,
} from './prompts/report-summary.prompt';
import type { ReportsAiSummaryContext } from './reports-ai-summary-context.service';
import {
  reportSummarySchema,
  type ReportSummaryStructuredOutput,
} from './schemas/report-summary.schema';

@Injectable()
export class ReportsAiSummaryGeneratorService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('analysis');
  }

  async generate(
    context: ReportsAiSummaryContext,
    promptCopy: ReportSummaryPromptCopy,
  ): Promise<ReportSummaryStructuredOutput> {
    const model = this.llmRuntimeService
      .createChatModel('analysis', {
        timeout: 10_000,
        temperature: 0.2,
        maxRetries: 0,
      })
      .withStructuredOutput(reportSummarySchema, {
        name: 'ReportSummary',
        method: 'functionCalling',
        strict: true,
      });

    return model.invoke([
      new SystemMessage(buildReportSummarySystemPrompt()),
      new HumanMessage(buildReportSummaryUserPrompt(context, promptCopy)),
    ]);
  }
}
