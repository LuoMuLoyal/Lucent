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
      { listFactsInRange: vi.fn().mockResolvedValue([]) } as never,
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

  describe('buildMealAnalysisDigest', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-10T08:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function buildFact(overrides: Record<string, unknown> = {}) {
      return {
        id: 'meal-1',
        kind: 'meal',
        occurredAt: new Date('2026-07-09T00:00:00.000Z'),
        occurredTime: '12:30',
        title: '午饭',
        value: null,
        unit: null,
        note: null,
        payload: null,
        mealAnalysisStatus: 'analyzed',
        mealAnalysisUpdatedAt: new Date('2026-07-09T04:40:00.000Z'),
        mealAnalysisFailureReason: null,
        mealHeadline: '油炸偏多',
        mealCalorieMin: 520,
        mealCalorieMax: 780,
        mealCalorieBucket: 'medium',
        createdAt: new Date('2026-07-09T04:00:00.000Z'),
        ...overrides,
      };
    }

    function buildService(facts: unknown[]) {
      const listFactsInRange = vi.fn().mockResolvedValue(facts);
      const service = new AssistantToolRecordQueryService(
        { list: vi.fn() } as never,
        { listFactsInRange } as never,
      );
      return { service, listFactsInRange };
    }

    it('reads the projection columns for a default seven-day window', async () => {
      const { service, listFactsInRange } = buildService([buildFact()]);

      const digest = await service.buildMealAnalysisDigest('u1', undefined);

      expect(listFactsInRange).toHaveBeenCalledWith(
        'u1',
        new Date(Date.UTC(2026, 6, 4)),
        new Date(Date.UTC(2026, 6, 10)),
        ['meal'],
      );
      expect(digest).toMatchObject({
        startDate: '2026-07-04',
        endDate: '2026-07-10',
        windowDays: 7,
        limit: 20,
        requestedDays: null,
        daysCapped: false,
        limitCapped: false,
        analyzedMealCount: 1,
      });
      expect(digest.meals).toEqual([
        {
          date: '2026-07-09',
          occurredTime: '12:30',
          title: '午饭',
          headline: '油炸偏多',
          calorieRange: {
            min: 520,
            max: 780,
            unit: 'kcal',
            bucket: 'medium',
          },
          items: [],
          dishes: [],
        },
      ]);
    });

    it('keeps only analyzed meals, newest first, and cuts at the limit', async () => {
      const { service } = buildService([
        buildFact({
          id: 'meal-analyzing',
          occurredAt: new Date('2026-07-09T00:00:00.000Z'),
          mealAnalysisStatus: 'analyzing',
          mealHeadline: null,
          mealCalorieMin: null,
          mealCalorieMax: null,
          mealCalorieBucket: null,
        }),
        buildFact({
          id: 'meal-older',
          occurredAt: new Date('2026-07-08T00:00:00.000Z'),
          mealHeadline: '蔬菜丰富',
        }),
        buildFact({
          id: 'meal-newer',
          occurredAt: new Date('2026-07-10T00:00:00.000Z'),
          mealHeadline: '碳水偏少',
        }),
        buildFact({
          id: 'meal-failed',
          occurredAt: new Date('2026-07-10T00:00:00.000Z'),
          mealAnalysisStatus: 'analysis_failed',
          mealHeadline: null,
        }),
      ]);

      const capped = await service.buildMealAnalysisDigest('u1', { limit: 1 });
      expect(capped.analyzedMealCount).toBe(2);
      expect(capped.limitCapped).toBe(true);
      expect(capped.meals.map((meal) => meal.headline)).toEqual(['碳水偏少']);

      const full = await service.buildMealAnalysisDigest('u1', { limit: 20 });
      expect(full.meals.map((meal) => meal.headline)).toEqual([
        '碳水偏少',
        '蔬菜丰富',
      ]);
    });

    it('caps the requested window and limit at the server maximum', async () => {
      const { service, listFactsInRange } = buildService([]);

      const digest = await service.buildMealAnalysisDigest('u1', {
        days: 30,
        limit: 99,
      });

      expect(listFactsInRange).toHaveBeenCalledWith(
        'u1',
        new Date(Date.UTC(2026, 5, 26)),
        new Date(Date.UTC(2026, 6, 10)),
        ['meal'],
      );
      expect(digest).toMatchObject({
        windowDays: 15,
        requestedDays: 30,
        daysCapped: true,
        limit: 20,
        requestedLimit: 99,
      });
    });

    it('falls back to defaults for unusable arguments', async () => {
      const { service } = buildService([]);

      const zero = await service.buildMealAnalysisDigest('u1', {
        days: 0,
        limit: -3,
      });
      const garbage = await service.buildMealAnalysisDigest('u1', {
        days: 'many',
        limit: null,
      });

      expect(zero).toMatchObject({
        windowDays: 7,
        limit: 20,
        requestedDays: null,
        requestedLimit: null,
      });
      expect(garbage).toMatchObject({
        windowDays: 7,
        limit: 20,
        requestedDays: null,
        requestedLimit: null,
      });
    });

    it('reads items and dish names from the stored payload of returned meals', async () => {
      const { service } = buildService([
        buildFact({
          payload: {
            mealAnalysis: {
              version: 2,
              analysisStatus: 'analyzed',
              analyzedAt: '2026-07-09T04:40:00.000Z',
              sourceRevision: 1,
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
              dishes: [
                { name: '红烧肉', source: 'model' },
                { name: '青菜', source: 'user' },
              ],
              items: [
                {
                  rank: 1,
                  kind: 'fried',
                  polarity: 'watch',
                  headline: '油炸偏多',
                  detail: '午饭油炸食品摄入偏多，建议晚饭多摄入蔬菜',
                },
              ],
              facets: { fried: 'high' },
            },
          },
        }),
      ]);

      const digest = await service.buildMealAnalysisDigest('u1', undefined);

      expect(digest.meals[0]?.dishes).toEqual(['红烧肉', '青菜']);
      expect(digest.meals[0]?.items).toEqual([
        {
          rank: 1,
          kind: 'fried',
          polarity: 'watch',
          headline: '油炸偏多',
          detail: '午饭油炸食品摄入偏多，建议晚饭多摄入蔬菜',
        },
      ]);
    });

    it('reports a missing interval without inventing one', async () => {
      const { service } = buildService([
        buildFact({
          mealCalorieMin: null,
          mealCalorieMax: null,
          mealCalorieBucket: null,
          mealHeadline: null,
        }),
      ]);

      const digest = await service.buildMealAnalysisDigest('u1', undefined);

      expect(digest.meals[0]).toMatchObject({
        calorieRange: null,
        headline: null,
      });
    });
  });
});
