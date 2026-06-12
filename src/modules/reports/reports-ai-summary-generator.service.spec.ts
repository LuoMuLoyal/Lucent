import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../llm-runtime/llm-runtime.service';
import { REPORT_RANGE_LAST_7_DAYS } from './dto';
import { ReportsAiSummaryGeneratorService } from './reports-ai-summary-generator.service';

describe('ReportsAiSummaryGeneratorService', () => {
  it('delegates generation to llm runtime with structured output', async () => {
    const invoke = jest.fn().mockResolvedValue({
      summary: 'ok',
      bullets: [
        { kind: 'general', text: 'a' },
        { kind: 'sleep', text: 'b' },
      ],
      actionLabel: 'View report',
      confidenceNote: 'Generated from records only.',
    });
    const withStructuredOutput = jest.fn().mockReturnValue({ invoke });
    const createChatModel = jest.fn().mockReturnValue({ withStructuredOutput });
    const service = new ReportsAiSummaryGeneratorService({
      hasRoleConfig: jest.fn(),
      createChatModel,
    } as unknown as LlmRuntimeService);

    const result = await service.generate(
      {
        range: REPORT_RANGE_LAST_7_DAYS,
        startDate: '2026-06-06',
        endDate: '2026-06-12',
        generatedAt: '2026-06-12T08:00:00.000Z',
        score: {
          value: 78,
          maxValue: 100,
          status: 'stable',
        },
        metrics: [
          {
            kind: 'medication',
            value: '83',
            unit: '%',
            status: 'stable',
            delta: '+17%',
            direction: 'up',
          },
          {
            kind: 'water',
            value: '1.5',
            unit: 'L',
            status: 'stable',
            delta: '-0.3',
            direction: 'down',
          },
          {
            kind: 'sleep',
            value: '--',
            unit: 'h',
            status: 'insufficient_data',
            delta: '--',
            direction: 'flat',
          },
        ],
        series: {
          medication: [100, 50, 100, 0, 100, 50, 100],
          water: [1.8, 1.4, 1.7, 1.2, 1.6, 1.1, 1.5],
          sleep: [0, 0, 0, 0, 0, 0, 0],
        },
        dataQuality: {
          medicationTrackedDays: 6,
          waterTrackedDays: 7,
          sleepTrackedDays: 0,
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
