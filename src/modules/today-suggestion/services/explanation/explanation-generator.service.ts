import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/base-llm-generator.service';
import { LlmRuntimeService } from '../../../../llm-runtime/services/llm-runtime.service';
import {
  buildExplanationSystemPrompt,
  buildExplanationUserPrompt,
  type ExplanationContext,
  type ExplanationPromptCopy,
} from '../../prompts/explanation.prompt';
import {
  explanationSchema,
  type ExplanationStructuredOutput,
} from '../../schemas/explanation.schema';

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

  public constructor(llmRuntimeService: LlmRuntimeService) {
    super(llmRuntimeService);
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
