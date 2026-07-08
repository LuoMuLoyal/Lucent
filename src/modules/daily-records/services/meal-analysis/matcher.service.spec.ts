import { MealAnalysisMatcherService } from '../meal-analysis/matcher.service';

describe('MealAnalysisMatcherService', () => {
  it('matches recognized foods to food composition items and aggregates conservative nutrition totals', async () => {
    const decompositionService = {
      resolveRecognizedDishes: jest.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '米饭',
            normalizedDishName: '米饭',
            confidence: 0.93,
            portionText: '1碗',
            source: 'vision',
          },
          {
            dishKey: 'dish-2',
            rawName: '鸡胸肉',
            normalizedDishName: '鸡胸肉',
            confidence: 0.89,
            portionText: '约100克',
            source: 'vision',
          },
          {
            dishKey: 'dish-3',
            rawName: '西兰花',
            normalizedDishName: '西兰花',
            confidence: 0.51,
            portionText: '少量',
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            normalizedIngredientName: '米饭',
            defaultRatio: 1,
            decompositionSource: 'model',
            confidence: 0.93,
          },
          {
            dishKey: 'dish-2',
            ingredientName: '鸡胸肉',
            normalizedIngredientName: '鸡胸肉',
            defaultRatio: 1,
            decompositionSource: 'model',
            confidence: 0.89,
          },
          {
            dishKey: 'dish-3',
            ingredientName: '西兰花',
            normalizedIngredientName: '西兰花',
            defaultRatio: 1,
            decompositionSource: 'model',
            confidence: 0.51,
          },
        ],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: jest.fn().mockResolvedValue({
        coverage: 'partial',
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: 'food-rice',
            matchedFoodName: '米饭',
            matchMethod: 'exact',
            matchScore: 1,
          },
          {
            dishKey: 'dish-2',
            ingredientName: '鸡胸肉',
            matchedFoodId: 'food-chicken',
            matchedFoodName: '鸡胸肉',
            matchMethod: 'exact',
            matchScore: 1,
          },
          {
            dishKey: 'dish-3',
            ingredientName: '西兰花',
            matchedFoodId: null,
            matchedFoodName: null,
            matchMethod: 'unmatched',
            matchScore: 0,
          },
        ],
        nutritionEstimate: {
          energyKcal: 249,
          proteinG: 22,
          fatG: 5.3,
          carbohydrateG: 25.9,
          fiberG: 0.3,
          sodiumMg: 48,
          matchedItemCount: 2,
          totalItemCount: 3,
          unmatchedItemCount: 1,
        },
      }),
    };
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    };
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

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
      unresolvedDishNames: [],
    });
  });
});
