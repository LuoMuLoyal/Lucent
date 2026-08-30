import { Injectable } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service';
import { LlmRuntimeService } from '../../../../llm-runtime';
import { MetricsService } from '../../../../common/metrics/metrics.service';
import {
  buildMedicineRiskSystemPrompt,
  buildMedicineRiskUserPrompt,
  type MedicineRiskLlmContext,
  type MedicineRiskLlmPromptCopy,
} from '../../prompts/risk-check.prompt';
import {
  medicineRiskLlmSchema,
  type MedicineRiskLlmOutput,
} from '../../schemas/risk-check.schema';

@Injectable()
export class MedicineRiskLlmGeneratorService extends BaseLlmGeneratorService<
  MedicineRiskLlmContext,
  MedicineRiskLlmPromptCopy,
  MedicineRiskLlmOutput
> {
  protected readonly schema = medicineRiskLlmSchema;
  protected readonly modelRole = 'analysis';
  protected readonly options = {
    toolName: 'MedicineRiskCheck',
    streamName: 'Medicine risk LLM check',
  } as const;

  public constructor(
    llmRuntimeService: LlmRuntimeService,
    metricsService: MetricsService,
    circuitBreaker: LlmCircuitBreakerService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return buildMedicineRiskSystemPrompt();
  }

  protected buildUserPrompt(
    context: MedicineRiskLlmContext,
    promptCopy: MedicineRiskLlmPromptCopy,
  ): string {
    return buildMedicineRiskUserPrompt(context, promptCopy);
  }
}
