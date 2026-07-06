import { Injectable } from '@nestjs/common';
import { BaseAiGeneratorService } from '../../../common/ai/base-ai-generator.service';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';
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
export class TodayAnalysisGeneratorService extends BaseAiGeneratorService<
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

  public constructor(llmRuntimeService: LlmRuntimeService) {
    super(llmRuntimeService);
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
