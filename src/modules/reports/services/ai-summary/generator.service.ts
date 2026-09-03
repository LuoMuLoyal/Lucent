import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  buildReportSummarySystemPrompt,
  buildReportSummaryUserPrompt,
  type ReportSummaryPromptCopy,
} from '../../prompts/report-summary.prompt.js';
import {
  reportSummarySchema,
  type ReportSummaryStructuredOutput,
} from '../../schemas/report-summary.schema.js';
import type { ReportsAiSummaryContext } from './context.service.js';

@Injectable()
export class ReportsAiSummaryGeneratorService extends BaseLlmGeneratorService<
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

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
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
