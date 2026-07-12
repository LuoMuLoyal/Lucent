import { MealDishDecompositionService } from '../meal-dish/decomposition.service';

describe('MealDishDecompositionService', () => {
  it('returns template ingredients without calling the model when a dish template exists', async () => {
    const invoke = vi.fn();
    const prisma = buildPrisma([
      {
        id: 'template-1',
        normalizedDishName: '西红柿炒鸡蛋',
        displayName: '西红柿炒鸡蛋',
        aliases: ['番茄炒蛋'],
        ingredients: [
          {
            ingredientName: '西红柿',
            normalizedIngredientName: '西红柿',
            defaultRatio: 0.6,
            foodCompositionItemId: 'food-tomato',
            sortOrder: 1,
          },
          {
            ingredientName: '鸡蛋',
            normalizedIngredientName: '鸡蛋',
            defaultRatio: 0.4,
            foodCompositionItemId: 'food-egg',
            sortOrder: 2,
          },
        ],
      },
    ]);
    const service = new MealDishDecompositionService(
      prisma as never,
      buildRuntime({ invoke }) as never,
    );

    const result = await service.resolveRecognizedDishes([
      {
        rawName: '西红柿炒鸡蛋',
        normalizedDishName: '西红柿炒鸡蛋',
        confidence: 0.95,
        portionText: '一份',
        source: 'vision',
        dishKey: 'dish-1',
      },
    ]);

    expect(invoke).not.toHaveBeenCalled();
    expect(result.recognizedDishes[0]).toEqual({
      rawName: '西红柿炒鸡蛋',
      normalizedDishName: '西红柿炒鸡蛋',
      confidence: 0.95,
      portionText: '一份',
      source: 'vision',
      dishKey: 'dish-1',
    });
    expect(result.resolvedIngredients).toEqual([
      {
        dishKey: 'dish-1',
        ingredientName: '西红柿',
        normalizedIngredientName: '西红柿',
        defaultRatio: 0.6,
        decompositionSource: 'template',
        confidence: 1,
      },
      {
        dishKey: 'dish-1',
        ingredientName: '鸡蛋',
        normalizedIngredientName: '鸡蛋',
        defaultRatio: 0.4,
        decompositionSource: 'template',
        confidence: 1,
      },
    ]);
    expect(result.unresolvedDishes).toEqual([]);
  });

  it('uses the language model for unresolved dishes and parses structured ingredient output', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content:
        '```json\n{"normalizedDishName":"肉末茄子","ingredients":[{"ingredientName":"茄子","normalizedIngredientName":"茄子","defaultRatio":0.7,"confidence":0.95},{"ingredientName":"猪肉","normalizedIngredientName":"猪肉","defaultRatio":0.2,"confidence":0.83},{"ingredientName":"红椒","normalizedIngredientName":"红椒","defaultRatio":0.1,"confidence":0.71}]}\n```',
    });
    const service = new MealDishDecompositionService(
      buildPrisma([]) as never,
      buildRuntime({ invoke }) as never,
    );

    const result = await service.resolveRecognizedDishes([
      {
        rawName: '肉末茄子',
        normalizedDishName: '肉末茄子',
        confidence: 0.92,
        portionText: '一份',
        source: 'vision',
        dishKey: 'dish-2',
      },
    ]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.recognizedDishes[0]?.normalizedDishName).toBe('肉末茄子');
    expect(result.resolvedIngredients).toEqual([
      {
        dishKey: 'dish-2',
        ingredientName: '茄子',
        normalizedIngredientName: '茄子',
        defaultRatio: 0.7,
        decompositionSource: 'model',
        confidence: 0.95,
      },
      {
        dishKey: 'dish-2',
        ingredientName: '猪肉',
        normalizedIngredientName: '猪肉',
        defaultRatio: 0.2,
        decompositionSource: 'model',
        confidence: 0.83,
      },
      {
        dishKey: 'dish-2',
        ingredientName: '红椒',
        normalizedIngredientName: '红椒',
        defaultRatio: 0.1,
        decompositionSource: 'model',
        confidence: 0.71,
      },
    ]);
    expect(result.unresolvedDishes).toEqual([]);
  });

  it('marks dishes unresolved when the model response is not valid structured JSON', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: '这道菜像是麻婆豆腐，不过我没有按要求返回 JSON',
    });
    const service = new MealDishDecompositionService(
      buildPrisma([]) as never,
      buildRuntime({ invoke }) as never,
    );

    const result = await service.resolveRecognizedDishes([
      {
        rawName: '麻婆豆腐',
        normalizedDishName: '麻婆豆腐',
        confidence: 0.93,
        portionText: '一份',
        source: 'vision',
        dishKey: 'dish-3',
      },
    ]);

    expect(result.resolvedIngredients).toEqual([]);
    expect(result.unresolvedDishes).toEqual([
      {
        dishKey: 'dish-3',
        rawName: '麻婆豆腐',
        normalizedDishName: '麻婆豆腐',
        reason: 'decomposition_failed',
      },
    ]);
  });
});

function buildPrisma(templates: Array<Record<string, unknown>>): {
  mealDishTemplate: {
    findMany: vi.Mock;
  };
} {
  return {
    mealDishTemplate: {
      findMany: vi.fn().mockResolvedValue(templates),
    },
  };
}

function buildRuntime(options: { invoke: vi.Mock }): {
  hasRoleConfig: vi.Mock;
  createChatModel: vi.Mock;
} {
  return {
    hasRoleConfig: vi.fn().mockReturnValue(true),
    createChatModel: vi.fn().mockReturnValue({
      invoke: options.invoke,
    }),
  };
}
