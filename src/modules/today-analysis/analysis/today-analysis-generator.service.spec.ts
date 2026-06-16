import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import { TodayAnalysisGeneratorService } from './today-analysis-generator.service';

describe('TodayAnalysisGeneratorService', () => {
  it('delegates generation to llm runtime with structured output', async () => {
    const invoke = jest.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [
        { kind: 'general', text: 'a' },
        { kind: 'sleep', text: 'b' },
      ],
      actionLabel: 'View today',
      confidenceNote: 'Generated from records only.',
    });
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const createChatModel = jest.fn().mockReturnValue({ withStructuredOutput });
    const service = new TodayAnalysisGeneratorService({
      hasRoleConfig: jest.fn(),
      createChatModel,
    } as unknown as LlmRuntimeService);

    const result = await service.generate(
      {
        date: '2026-06-12',
        water: { completedCount: 4, targetCount: 8, remainingCount: 4 },
        medication: {
          medicineCount: 2,
          pendingCount: 1,
          nextDoseTimeLabel: '20:00',
          nextMedicineName: 'Vitamin B',
          currentMedicineNames: ['Vitamin B'],
        },
        recordSummary: [],
        recentRecords: [],
        sleep: {
          status: 'insufficient_data',
          durationMinutes: null,
          quality: null,
          startAt: null,
          endAt: null,
          deepMinutes: null,
          lightMinutes: null,
          remMinutes: null,
        },
        lowRiskContext: {
          activeAllergyCount: 0,
          currentMedicineCount: 2,
        },
      },
      {
        userIntro: 'intro',
        tone: 'tone',
        actionLabelHint: 'hint',
        factsLabel: 'facts',
      },
    );

    expect(createChatModel).toHaveBeenCalledWith('analysis', {
      timeout: 10_000,
      temperature: 0.2,
      maxRetries: 0,
    });
    expect(withStructuredOutput).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith([
      expect.any(SystemMessage),
      expect.any(HumanMessage),
    ]);
    expect(result.summary).toBe('ok');
  });
});
