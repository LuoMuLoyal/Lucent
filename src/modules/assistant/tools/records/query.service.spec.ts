import { AssistantToolRecordQueryService } from './query.service.js';

describe('AssistantToolRecordQueryService', () => {
  it('surfaces meal analysis status and keeps payload available for assistant reasoning', async () => {
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
                version: 2,
                analysisStatus: 'analyzed',
                analyzedAt: '2026-07-01T04:45:00.000Z',
                sourceRevision: 2,
                model: 'vision-model',
                promptVersion: 'meal-analysis.v2',
                locale: 'zh-CN',
                failureReason: null,
                calorieRange: {
                  min: 520,
                  max: 780,
                  unit: 'kcal',
                  bucket: 'medium',
                },
                dishes: [{ name: '米饭', source: 'model' }],
                items: [
                  {
                    rank: 1,
                    kind: 'protein',
                    polarity: 'good',
                    headline: '蛋白充足',
                    detail: '这一餐的蛋白质摄入充足',
                  },
                ],
                facets: { protein: 'ok' },
              },
            },
            createdAt: '2026-07-01T04:30:00.000Z',
            updatedAt: '2026-07-01T04:45:00.000Z',
            mealAnalysisStatus: 'analyzed',
            mealAnalysisUpdatedAt: '2026-07-01T04:45:00.000Z',
            mealAnalysisFailureReason: null,
            mealHeadline: '蛋白充足',
            mealCalorieMin: 520,
            mealCalorieMax: 780,
            mealCalorieBucket: 'medium',
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
          mealAnalysis: expect.objectContaining({
            analysisStatus: 'analyzed',
            locale: 'zh-CN',
          }),
        },
        mealHeadline: '蛋白充足',
        mealCalorieBucket: 'medium',
        tags: ['meal_estimate:analyzed'],
      }),
    ]);
  });
});
