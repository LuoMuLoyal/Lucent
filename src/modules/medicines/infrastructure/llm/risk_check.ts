import { Injectable, Optional } from '@nestjs/common';
import { BaseLlmGeneratorService } from '../../../../common/llm/generators/base-llm-generator.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import { resolveRuntimePrompt } from '../../../../config/runtime/prompt-registry.js';
import { MetricsService } from '../../../../common/metrics/metrics.service.js';
import {
  buildMedicineRiskSystemPrompt,
  buildMedicineRiskUserPrompt,
  type MedicineRiskLlmContext,
  type MedicineRiskLlmPromptCopy,
} from './prompts/risk_check.js';
import {
  medicineRiskLlmSchema,
  type MedicineRiskLlmOutput,
} from './schemas/risk_check.js';

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
    @Optional()
    private readonly runtimeConfigService?: RuntimeConfigService,
  ) {
    super(llmRuntimeService, metricsService, circuitBreaker);
  }

  protected buildSystemPrompt(): string {
    return resolveRuntimePrompt(
      this.runtimeConfigService,
      'riskCheck',
      () => buildMedicineRiskSystemPrompt(),
      {},
    );
  }

  protected buildUserPrompt(
    context: MedicineRiskLlmContext,
    promptCopy: MedicineRiskLlmPromptCopy,
  ): string {
    return buildMedicineRiskUserPrompt(context, promptCopy);
  }
}
