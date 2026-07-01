import type { PrismaService } from '../../../prisma/prisma.service';
import { MealAnalysisMatcherService } from './meal-analysis-matcher.service';

describe('MealAnalysisMatcherService', () => {
  it('matches recognized foods to food composition items and aggregates conservative nutrition totals', async () => {
    const prisma = buildPrisma([
      {
        id: 'food-rice',
        name: '米饭',
        normalizedName: '米饭',
        aliases: ['大米饭'],
        ediblePortionPercent: 100,
        energyKcal: 116,
        proteinG: 2.6,
        fatG: 0.3,
        carbohydrateG: 25.9,
        fiberG: 0.3,
        sodiumMg: 2,
      },
      {
        id: 'food-chicken',
        name: '鸡胸肉',
        normalizedName: '鸡胸肉',
        aliases: [],
        ediblePortionPercent: 100,
        energyKcal: 133,
        proteinG: 19.4,
        fatG: 5,
        carbohydrateG: 0,
        fiberG: 0,
        sodiumMg: 46,
      },
    ]);
    const service = new MealAnalysisMatcherService(prisma as never);

    const result = await service.matchAndEstimate([
      {
        name: '米饭',
        confidence: 0.93,
        portionText: '1碗',
      },
      {
        name: '鸡胸肉',
        confidence: 0.89,
        portionText: '约100克',
      },
      {
        name: '西兰花',
        confidence: 0.51,
        portionText: '少量',
      },
    ]);

    expect(result.coverage).toBe('partial');
    expect(result.foodItems).toEqual([
      expect.objectContaining({
        name: '米饭',
        matchedFoodId: 'food-rice',
        matchedFoodName: '米饭',
        estimatedGrams: 100,
      }),
      expect.objectContaining({
        name: '鸡胸肉',
        matchedFoodId: 'food-chicken',
        matchedFoodName: '鸡胸肉',
        estimatedGrams: 100,
      }),
      expect.objectContaining({
        name: '西兰花',
        matchedFoodId: null,
        matchedFoodName: null,
        estimatedGrams: null,
      }),
    ]);
    expect(result.nutritionEstimate).toEqual({
      energyKcal: 249,
      proteinG: 22,
      fatG: 5.3,
      carbohydrateG: 25.9,
      fiberG: 0.3,
      sodiumMg: 48,
      matchedItemCount: 2,
      totalItemCount: 3,
      unmatchedItemCount: 1,
    });
    expect(result.mealCommentary).toContain('蛋白质');
    expect(result.matchDiagnostics).toEqual({
      matchedItemCount: 2,
      unmatchedNames: ['西兰花'],
    });
  });
});

function buildPrisma(items: Array<Record<string, unknown>>): {
  foodCompositionItem: Pick<PrismaService['foodCompositionItem'], 'findMany'>;
} {
  return {
    foodCompositionItem: {
      findMany: jest.fn().mockResolvedValue(items),
    },
  };
}
