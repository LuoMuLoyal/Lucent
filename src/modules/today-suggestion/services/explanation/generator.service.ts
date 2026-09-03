import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
  type ExplanationContext,
  type ExplanationPromptCopy,
} from '../../prompts/explanation.prompt.js';
import {
  explanationSchema,
  type ExplanationStructuredOutput,
} from '../../schemas/explanation.schema.js';

/**
 * LLM generator for suggestion card explanations.
 *
 * Extends BaseLlmGeneratorService to use structured-output function calling
 * with a Zod schema, following the same pattern as TodayAnalysisGeneratorService.
 */
@Injectable()
export class ExplanationGeneratorService extends BaseLlmGeneratorService<
  ExplanationContext,
  ExplanationPromptCopy,
  ExplanationStructuredOutput
> {
  protected readonly schema = explanationSchema;
  protected readonly modelRole = 'language' as const;
  protected readonly options = {
    toolName: 'SuggestionExplanation',
    streamName: 'Suggestion explanation',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return buildExplanationSystemPrompt();
  }

  protected buildUserPrompt(
    context: ExplanationContext,
    promptCopy: ExplanationPromptCopy,
  ): string {
    return buildExplanationUserPrompt(context, promptCopy);
  }
}
