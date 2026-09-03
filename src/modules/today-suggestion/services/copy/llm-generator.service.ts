import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  GeneratedCopySchema,
  type GeneratedCopy,
} from '../../schemas/copy.schema.js';
import type {
  CopyGenerationContext,
  CopyPromptCopy,
} from '../../types/copy-generation.types.js';
import {
  buildCopySystemPrompt,
  buildCopyUserPrompt,
} from '../../prompts/copy.prompt.js';

/**
 * LLM generator for suggestion card copy.
 *
 * Extends BaseLlmGeneratorService to use structured-output function calling
 * with a Zod schema, following the same pattern as ExplanationGeneratorService.
 *
 * Key differences from the legacy CopyGeneratorService:
 * - No longer directly instantiates ChatOpenAI; reuses LlmRuntimeService model role config.
 * - buildUserPrompt receives full context (evidence, confidence, suggestionType...),
 *   not just templateKey + params, enabling more grounded copy generation.
 */
@Injectable()
export class SuggestionCopyLlmService extends BaseLlmGeneratorService<
  CopyGenerationContext,
  CopyPromptCopy,
  GeneratedCopy
> {
  protected readonly schema = GeneratedCopySchema;
  protected readonly modelRole = 'language' as const;
  protected readonly options = {
    toolName: 'generate_suggestion_copy',
    streamName: 'SuggestionCopy',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return buildCopySystemPrompt({ tone: 'gentle' });
  }

  protected buildUserPrompt(
    context: CopyGenerationContext,
    promptCopy: CopyPromptCopy,
  ): string {
    return buildCopyUserPrompt(context, promptCopy);
  }
}
