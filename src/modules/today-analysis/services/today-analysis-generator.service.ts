import { Injectable } from '@nestjs/common';
import { BaseAiGeneratorService } from '../../../common/ai/base-ai-generator.service';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import {
  buildTodayAnalysisSystemPrompt,
  buildTodayAnalysisUserPrompt,
  type TodayAnalysisPromptCopy,
} from '../prompts/today-analysis.prompt';
import {
  todayAnalysisSchema,
  type TodayAnalysisStructuredOutput,
} from '../schemas/today-analysis.schema';
import type { TodayAnalysisContext } from './today-analysis-context.service';

@Injectable()
export class TodayAnalysisGeneratorService extends BaseAiGeneratorService<
  TodayAnalysisContext,
  TodayAnalysisPromptCopy,
  TodayAnalysisStructuredOutput
> {
  protected readonly schema = todayAnalysisSchema;
  protected readonly options = {
    toolName: 'TodayAnalysis',
    streamName: 'Today analysis',
  } as const;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- NestJS needs this constructor signature for DI even though it only forwards to super.
  constructor(llmRuntimeService: LlmRuntimeService) {
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
