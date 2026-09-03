import { MealAnalysisMatcherService } from '../meal-analysis/matcher.service.js';
import { loadYamlConfig } from '../../../../config/yaml/yaml-loader.js';

const yamlConfig = loadYamlConfig();

function createMockConfigService() {
  return {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'yaml') return yamlConfig;
      throw new Error(`Missing config: ${key}`);
    }),
  };
}

describe('MealAnalysisMatcherService', () => {
  it('matches recognized foods to food composition items and aggregates conservative nutrition totals', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
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
      groundIngredients: vi.fn().mockResolvedValue({
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
    const configService = createMockConfigService();
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

  // ── Edge cases ──────────────────────────────────────────────────────

  it('returns null diagnostics and null commentary for empty recognized items', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [],
        resolvedIngredients: [],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'none',
        compositionMatches: [],
        nutritionEstimate: null,
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([]);

    expect(result.coverage).toBe('none');
    expect(result.foodItems).toEqual([]);
    expect(result.nutritionEstimate).toBeNull();
    expect(result.mealCommentary).toBeNull();
    expect(result.matchDiagnostics).toBeNull();
  });

  it('handles complete coverage with all items matched', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '米饭',
            normalizedDishName: '米饭',
            confidence: 0.95,
            portionText: '1碗',
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
            confidence: 0.95,
          },
        ],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: 'food-rice',
            matchedFoodName: '米饭',
            matchMethod: 'exact',
            matchScore: 1,
          },
        ],
        nutritionEstimate: {
          energyKcal: 130,
          proteinG: 2.7,
          fatG: 0.3,
          carbohydrateG: 28.2,
          fiberG: 0.4,
          sodiumMg: 1,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([
      { name: '米饭', confidence: 0.95, portionText: '1碗' },
    ]);

    expect(result.coverage).toBe('complete');
    expect(result.foodItems[0]!.matchedFoodId).toBe('food-rice');
    expect(result.foodItems[0]!.estimatedGrams).toBe(100); // default portion for 碗
    // proteinG=2.7 < highProteinThreshold=20, fatG=0.3 < highFatThreshold=20,
    // carbohydrateG=28.2 > lowCarbThreshold=20 → no threshold triggered
    expect(result.mealCommentary).toBe('这一餐营养结果为保守估算。');
    // No unmatched items, so commentary should not contain "未命中"
    expect(result.mealCommentary).not.toContain('未命中');
    expect(result.matchDiagnostics).toEqual({
      matchedItemCount: 1,
      unmatchedNames: [],
      unresolvedDishNames: [],
    });
  });

  it('handles none coverage with unresolved dishes', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '神秘菜品',
            normalizedDishName: '神秘菜品',
            confidence: 0.4,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: [],
        unresolvedDishes: [
          { rawName: '神秘菜品', normalizedDishName: '神秘菜品' },
        ],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'none',
        compositionMatches: [],
        nutritionEstimate: null,
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([
      { name: '神秘菜品', confidence: 0.4, portionText: null },
    ]);

    expect(result.coverage).toBe('none');
    expect(result.foodItems[0]!.matchedFoodId).toBeNull();
    expect(result.foodItems[0]!.estimatedGrams).toBeNull();
    expect(result.nutritionEstimate).toBeNull();
    expect(result.mealCommentary).toBeNull();
    // Diagnostics should exist because recognizedDishes is non-empty
    expect(result.matchDiagnostics).toEqual({
      matchedItemCount: 0,
      unmatchedNames: [],
      unresolvedDishNames: ['神秘菜品'],
    });
  });

  it('generates high-protein and high-fat commentary when thresholds are exceeded', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [],
        resolvedIngredients: [],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [],
        nutritionEstimate: {
          energyKcal: 500,
          proteinG: 35,
          fatG: 20,
          carbohydrateG: 50,
          fiberG: 2,
          sodiumMg: 300,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    // Use low thresholds so commentary conditions are triggered
    const customYaml = {
      ...yamlConfig,
      meal: {
        ...yamlConfig.meal,
        highProteinThresholdG: 30,
        highFatThresholdG: 15,
        lowCarbohydrateThresholdG: 60,
      },
    };
    const configService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'yaml') return customYaml;
        throw new Error(`Missing config: ${key}`);
      }),
    };
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([]);

    expect(result.mealCommentary).toContain('蛋白质较充足');
    expect(result.mealCommentary).toContain('油脂可能偏高');
    // carbohydrateG=50 < lowCarbThreshold=60 → low carb commentary
    expect(result.mealCommentary).toContain('碳水可能偏少');
  });

  it('returns conservative estimate commentary when no threshold is exceeded', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [],
        resolvedIngredients: [],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [],
        nutritionEstimate: {
          energyKcal: 200,
          proteinG: 5,
          fatG: 3,
          carbohydrateG: 40,
          fiberG: 1,
          sodiumMg: 50,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([]);

    expect(result.mealCommentary).toBe('这一餐营养结果为保守估算。');
  });

  it('estimates grams from portion text containing 克', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '牛排',
            normalizedDishName: '牛排',
            confidence: 0.9,
            portionText: '约250克',
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '牛排',
            normalizedIngredientName: '牛排',
            defaultRatio: 1,
            decompositionSource: 'model',
            confidence: 0.9,
          },
        ],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '牛排',
            matchedFoodId: 'food-steak',
            matchedFoodName: '牛排',
            matchMethod: 'exact',
            matchScore: 1,
          },
        ],
        nutritionEstimate: {
          energyKcal: 350,
          proteinG: 26,
          fatG: 12,
          carbohydrateG: 0,
          fiberG: 0,
          sodiumMg: 60,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([
      { name: '牛排', confidence: 0.9, portionText: '约250克' },
    ]);

    expect(result.foodItems[0]!.estimatedGrams).toBe(250);
  });

  it('estimates small portion grams for 少量 text', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '葱花',
            normalizedDishName: '葱花',
            confidence: 0.7,
            portionText: '少量',
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '葱花',
            normalizedIngredientName: '葱花',
            defaultRatio: 1,
            decompositionSource: 'model',
            confidence: 0.7,
          },
        ],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '葱花',
            matchedFoodId: 'food-scallion',
            matchedFoodName: '葱花',
            matchMethod: 'exact',
            matchScore: 1,
          },
        ],
        nutritionEstimate: {
          energyKcal: 5,
          proteinG: 0.2,
          fatG: 0.1,
          carbohydrateG: 1,
          fiberG: 0.1,
          sodiumMg: 1,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    const result = await service.matchAndEstimate([
      { name: '葱花', confidence: 0.7, portionText: '少量' },
    ]);

    // DEFAULT_MEAL_SMALL_PORTION_GRAMS is 30
    expect(result.foodItems[0]!.estimatedGrams).toBe(30);
  });

  it('filters out items with names that normalize to null', async () => {
    const decompositionService = {
      resolveRecognizedDishes: vi.fn().mockResolvedValue({
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '米饭',
            normalizedDishName: '米饭',
            confidence: 0.9,
            portionText: '1碗',
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
            confidence: 0.9,
          },
        ],
        unresolvedDishes: [],
      }),
    };
    const groundingService = {
      groundIngredients: vi.fn().mockResolvedValue({
        coverage: 'complete',
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: 'food-rice',
            matchedFoodName: '米饭',
            matchMethod: 'exact',
            matchScore: 1,
          },
        ],
        nutritionEstimate: {
          energyKcal: 130,
          proteinG: 2.7,
          fatG: 0.3,
          carbohydrateG: 28.2,
          fiberG: 0.4,
          sodiumMg: 1,
          matchedItemCount: 1,
          totalItemCount: 1,
          unmatchedItemCount: 0,
        },
      }),
    };
    const configService = createMockConfigService();
    const service = new MealAnalysisMatcherService(
      decompositionService as never,
      groundingService as never,
      configService as never,
    );

    // Pass one valid and one blank-space name
    const result = await service.matchAndEstimate([
      { name: '米饭', confidence: 0.9, portionText: '1碗' },
      { name: '   ', confidence: 0.3, portionText: null },
    ]);

    // Only one dish should be recognized (the blank one is filtered by normalizeMealEntityName)
    expect(decompositionService.resolveRecognizedDishes).toHaveBeenCalledWith([
      expect.objectContaining({ normalizedDishName: '米饭' }),
    ]);
    // The blank item should still appear in foodItems but with no match
    expect(result.foodItems).toHaveLength(2);
    expect(result.foodItems[1]!.matchedFoodId).toBeNull();
  });
});
