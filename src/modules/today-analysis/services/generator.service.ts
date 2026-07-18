import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../common/llm/base-llm-generator.service';
import { LlmCircuitBreakerService } from '../../../common/llm/llm-circuit-breaker.service';
import { LlmRuntimeService } from '../../../llm-runtime';
import { MetricsService } from '../../../common/metrics/metrics.service';
import {
  buildTodayAnalysisSystemPrompt,
  buildTodayAnalysisUserPrompt,
  type TodayAnalysisPromptCopy,
} from '../prompts/analysis.prompt';
import {
  todayAnalysisSchema,
  type TodayAnalysisStructuredOutput,
} from '../schemas/analysis.schema';
import type { TodayAnalysisContext } from './context.service';

@Injectable()
export class TodayAnalysisGeneratorService extends BaseLlmGeneratorService<
  TodayAnalysisContext,
  TodayAnalysisPromptCopy,
  TodayAnalysisStructuredOutput
> {
  protected readonly schema = todayAnalysisSchema;
  protected readonly modelRole = 'analysis';
  protected readonly options = {
    toolName: 'TodayAnalysis',
    streamName: 'Today analysis',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return buildTodayAnalysisSystemPrompt();
  }

  protected buildUserPrompt(
    context: TodayAnalysisContext,
    promptCopy: TodayAnalysisPromptCopy,
  ): string {
    return buildTodayAnalysisUserPrompt(context, promptCopy);
  }
}
