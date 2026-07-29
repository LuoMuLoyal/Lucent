import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/base-llm-generator.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/llm-circuit-breaker.service';
import { LlmRuntimeService } from '../../../../llm-runtime';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import {
  GeneratedCopySchema,
  type GeneratedCopy,
} from '../../schemas/copy.schema';
import type {
  CopyGenerationContext,
  CopyPromptCopy,
} from '../../types/copy-generation.types';
import {
  buildCopySystemPrompt,
  buildCopyUserPrompt,
} from '../../prompts/copy.prompt';

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
