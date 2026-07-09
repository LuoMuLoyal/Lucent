import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/base-llm-generator.service';
import { LlmRuntimeService } from '../../../../llm-runtime/services/llm-runtime.service';
import {
  buildDailyRecordCandidatesSystemPrompt,
  buildDailyRecordCandidatesUserPrompt,
  type DailyRecordCandidatesPromptCopy,
} from '../../prompts/daily-record-candidates.prompt';
import {
  dailyRecordCandidatesSchema,
  type DailyRecordCandidateStructuredOutput,
} from '../../schemas/daily-record-candidates.schema';

@Injectable()
export class DailyRecordCandidatesGeneratorService extends BaseLlmGeneratorService<
  unknown,
  DailyRecordCandidatesPromptCopy,
  DailyRecordCandidateStructuredOutput
> {
  protected readonly schema = dailyRecordCandidatesSchema;
  protected readonly modelRole = 'language';
  protected readonly options = {
    toolName: 'DailyRecordCandidates',
    streamName: 'Daily record candidates',
  } as const;

  public constructor(llmRuntimeService: LlmRuntimeService) {
    super(llmRuntimeService);
  }

  protected buildSystemPrompt(): string {
    return buildDailyRecordCandidatesSystemPrompt();
  }

  protected buildUserPrompt(
    context: unknown,
    promptCopy: DailyRecordCandidatesPromptCopy,
  ): string {
    return buildDailyRecordCandidatesUserPrompt(context, promptCopy);
  }
}
