import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import {
  buildTodayAnalysisSystemPrompt,
  buildTodayAnalysisUserPrompt,
  type TodayAnalysisPromptCopy,
} from './today-analysis.prompt';
import {
  todayAnalysisSchema,
  type TodayAnalysisStructuredOutput,
} from './today-analysis.schema';
import type { TodayAnalysisContext } from './today-analysis-context.service';

@Injectable()
export class TodayAnalysisGeneratorService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasAnalysisModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('analysis');
  }

  async generate(
    context: TodayAnalysisContext,
    promptCopy: TodayAnalysisPromptCopy,
  ): Promise<TodayAnalysisStructuredOutput> {
    const model = this.llmRuntimeService
      .createChatModel('analysis', {
        timeout: 10_000,
        temperature: 0.2,
        maxRetries: 0,
      })
      .withStructuredOutput(todayAnalysisSchema, {
        name: 'TodayAnalysis',
        method: 'functionCalling',
        strict: true,
      });

    return model.invoke([
      new SystemMessage(buildTodayAnalysisSystemPrompt()),
      new HumanMessage(buildTodayAnalysisUserPrompt(context, promptCopy)),
    ]);
  }
}
