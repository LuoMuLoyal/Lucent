import { Injectable, Optional } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import { resolveRuntimePrompt } from '../../../../config/runtime/prompt-registry.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  buildTodayAnalysisSystemPrompt,
  buildTodayAnalysisUserPrompt,
  type TodayAnalysisPromptCopy,
} from './prompts/analysis.js';
import {
  todayAnalysisSchema,
  type TodayAnalysisStructuredOutput,
} from './schemas/analysis.js';
import type { TodayAnalysisContext } from '../../application/read_models/analysis-context-shape.js';

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
    @Optional()
    private readonly runtimeConfigService?: RuntimeConfigService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return resolveRuntimePrompt(
      this.runtimeConfigService,
      'todayAnalysis',
      () => buildTodayAnalysisSystemPrompt(),
      {},
    );
  }

  protected buildUserPrompt(
    context: TodayAnalysisContext,
    promptCopy: TodayAnalysisPromptCopy,
  ): string {
    return buildTodayAnalysisUserPrompt(context, promptCopy);
  }
}
