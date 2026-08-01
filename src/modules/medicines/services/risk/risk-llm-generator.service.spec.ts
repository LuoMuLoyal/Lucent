import { describe, expect, it, vi } from 'vitest';
import { MedicineRiskLlmGeneratorService } from './risk-llm-generator.service';
import type { LlmRuntimeService } from '../../../../llm-runtime';
import type { MetricsService } from '../../../../common/metrics/metrics.service';
import { LlmCircuitBreakerService } from '../../../../common/llm/llm-circuit-breaker.service';
import type { MedicineRiskLlmContext } from '../../prompts/risk-check.prompt';

function build(hasAnalysisModel = true) {
  const mockModel = {
    invoke: vi.fn().mockResolvedValue({ riskScore: 5, riskLevel: 'safe' }),
    withStructuredOutput: vi.fn().mockReturnThis(),
  };
  const runtime = {
    hasRoleConfig: vi.fn(() => hasAnalysisModel),
    createChatModel: vi.fn().mockReturnValue(mockModel),
    getModelName: vi.fn().mockReturnValue('test-model'),
  } as unknown as LlmRuntimeService;
  const metrics = { recordLlmCall: vi.fn() } as unknown as MetricsService;
  const circuitBreaker = new LlmCircuitBreakerService();
  const svc = new MedicineRiskLlmGeneratorService(
    runtime,
    metrics,
    circuitBreaker,
  );
  return { runtime, mockModel, svc };
}

const ctx: MedicineRiskLlmContext = {
  medicines: [],
  allergies: [],
  conditions: [],
  reminders: [],
  staticFindings: [],
};

describe('MedicineRiskLlmGeneratorService', () => {
  it('reports model availability from the runtime', () => {
    const { svc } = build(true);
    expect(svc.hasAnalysisModel()).toBe(true);
    const { svc: svc2 } = build(false);
    expect(svc2.hasAnalysisModel()).toBe(false);
  });

  it('delegates generate to the structured-output model and returns parsed output', async () => {
    const { runtime, mockModel, svc } = build();
    const result = await svc.generate(ctx, {} as never);
    expect(runtime.createChatModel).toHaveBeenCalledWith(
      'analysis',
      expect.anything(),
    );
    expect(mockModel.withStructuredOutput).toHaveBeenCalledTimes(1);
    expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ riskScore: 5, riskLevel: 'safe' });
  });
});
