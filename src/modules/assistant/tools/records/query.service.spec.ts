import { AssistantToolRecordQueryService } from './query.service.js';

describe('AssistantToolRecordQueryService', () => {
  it('surfaces meal estimate status and keeps payload available for assistant reasoning', async () => {
    const dailyRecordsService = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'meal-1',
            kind: 'meal',
            occurredAt: '2026-07-01',
            title: null,
            value: null,
            unit: null,
            note: null,
            payload: {
              mealAnalysis: {
                analysisStatus: 'unconfirmed',
                coverage: 'partial',
                mealDescription: '一份米饭配鸡胸肉',
              },
            },
            createdAt: '2026-07-01T04:30:00.000Z',
            updatedAt: '2026-07-01T04:45:00.000Z',
            mealAnalysisStatus: 'unconfirmed',
            mealAnalysisCoverage: 'partial',
            mealAnalysisUpdatedAt: '2026-07-01T04:45:00.000Z',
            mealAnalysisFailureReason: null,
            mealShortDescription: '一份米饭配鸡胸肉',
            mealTopFoods: ['米饭', '鸡胸肉'],
          },
        ],
      }),
    };
    const service = new AssistantToolRecordQueryService(
      dailyRecordsService as never,
    );

    const records = await service.listToolRecords('u1', '2026-07-01', {
      includeSleep: true,
    });

    expect(records).toEqual([
      expect.objectContaining({
        id: 'meal-1',
        kind: 'meal',
        payload: {
          mealAnalysis: {
            analysisStatus: 'unconfirmed',
            coverage: 'partial',
            mealDescription: '一份米饭配鸡胸肉',
          },
        },
        tags: ['meal_estimate:unconfirmed', 'meal_coverage:partial'],
      }),
    ]);
  });
});
