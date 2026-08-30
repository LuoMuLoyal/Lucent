import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service';
import { LlmRuntimeService } from '../../../../llm-runtime';
import { MetricsService } from '../../../../common/metrics/metrics.service';
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

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
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
