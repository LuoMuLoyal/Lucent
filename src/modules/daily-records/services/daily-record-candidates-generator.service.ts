import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import {
  buildDailyRecordCandidatesSystemPrompt,
  buildDailyRecordCandidatesUserPrompt,
  type DailyRecordCandidatesPromptCopy,
} from '../prompts/daily-record-candidates.prompt';
import {
  dailyRecordCandidatesSchema,
  type DailyRecordCandidateStructuredOutput,
} from '../schemas/daily-record-candidates.schema';

@Injectable()
export class DailyRecordCandidatesGeneratorService {
  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

  hasLanguageModel(): boolean {
    return this.llmRuntimeService.hasRoleConfig('language');
  }

  async generate(
    context: unknown,
    promptCopy: DailyRecordCandidatesPromptCopy,
  ): Promise<DailyRecordCandidateStructuredOutput> {
    const model = this.llmRuntimeService
      .createChatModel('language', {
        timeout: 10_000,
        temperature: 0.1,
        maxRetries: 0,
      })
      .withStructuredOutput(dailyRecordCandidatesSchema, {
        name: 'DailyRecordCandidates',
        method: 'functionCalling',
        strict: true,
      });

    return model.invoke([
      new SystemMessage(buildDailyRecordCandidatesSystemPrompt()),
      new HumanMessage(
        buildDailyRecordCandidatesUserPrompt(context, promptCopy),
      ),
    ]);
  }
}
