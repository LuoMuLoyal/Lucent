import type { PrismaService } from '../../../prisma/prisma.service';
import { MealIngredientGroundingService } from './meal-ingredient-grounding.service';

describe('MealIngredientGroundingService', () => {
  it('accepts exact and alias matches directly and computes partial coverage', async () => {
    const prisma = buildPrisma({
      exact: [
        {
          id: 'food-rice',
          name: '米饭',
          normalizedName: '米饭',
          aliases: [],
          energyKcal: 116,
          proteinG: 2.6,
          fatG: 0.3,
          carbohydrateG: 25.9,
          fiberG: 0.3,
          sodiumMg: 2,
        },
      ],
      fuzzy: [],
    });
    const service = new MealIngredientGroundingService(prisma as never);

    const result = await service.groundIngredients([
      {
        dishKey: 'dish-1',
        ingredientName: '白米饭',
        normalizedIngredientName: '米饭',
        defaultRatio: 1,
        decompositionSource: 'model',
        confidence: 0.95,
      },
      {
        dishKey: 'dish-1',
        ingredientName: '海苔',
        normalizedIngredientName: '海苔',
        defaultRatio: 0.1,
        decompositionSource: 'model',
        confidence: 0.8,
      },
    ]);

    expect(result.compositionMatches).toEqual([
      expect.objectContaining({
        ingredientName: '白米饭',
        matchedFoodId: 'food-rice',
        matchedFoodName: '米饭',
        matchMethod: 'exact',
        matchScore: 1,
      }),
      expect.objectContaining({
        ingredientName: '海苔',
        matchedFoodId: null,
        matchedFoodName: null,
        matchMethod: 'unmatched',
        matchScore: 0,
      }),
    ]);
    expect(result.coverage).toBe('partial');
    expect(result.nutritionEstimate?.matchedItemCount).toBe(1);
    expect(result.nutritionEstimate?.unmatchedItemCount).toBe(1);
  });

  it('accepts fuzzy matches only when the score threshold and lead threshold both pass', async () => {
    const prisma = buildPrisma({
      exact: [],
      fuzzy: [
        [
          {
            id: 'food-tomato',
            name: '西红柿',
            normalizedName: '西红柿',
            aliases: [],
            searchText: '西红柿 番茄',
            energyKcal: 15,
            proteinG: 0.9,
            fatG: 0.2,
            carbohydrateG: 3.3,
            fiberG: 0.5,
            sodiumMg: 5,
          },
          0.82,
        ],
        [
          {
            id: 'food-potato',
            name: '土豆',
            normalizedName: '土豆',
            aliases: [],
            searchText: '土豆 马铃薯',
            energyKcal: 81,
            proteinG: 2.6,
            fatG: 0.2,
            carbohydrateG: 17.8,
            fiberG: 1.1,
            sodiumMg: 3,
          },
          0.55,
        ],
      ],
    });
    const service = new MealIngredientGroundingService(prisma as never);

    const result = await service.groundIngredients([
      {
        dishKey: 'dish-2',
        ingredientName: '番茄',
        normalizedIngredientName: '番茄',
        defaultRatio: 1,
        decompositionSource: 'model',
        confidence: 0.88,
      },
    ]);

    expect(result.compositionMatches[0]).toEqual(
      expect.objectContaining({
        ingredientName: '番茄',
        matchedFoodId: 'food-tomato',
        matchedFoodName: '西红柿',
        matchMethod: 'fuzzy',
        matchScore: 0.82,
      }),
    );
  });

  it('rejects fuzzy matches when the best score is too low or not clearly ahead', async () => {
    const prisma = buildPrisma({
      exact: [],
      fuzzy: [
        [
          {
            id: 'food-a',
            name: '豆腐',
            normalizedName: '豆腐',
            aliases: [],
            searchText: '豆腐',
            energyKcal: 81,
            proteinG: 8.1,
            fatG: 4.0,
            carbohydrateG: 4.2,
            fiberG: 0.0,
            sodiumMg: 7,
          },
          0.72,
        ],
        [
          {
            id: 'food-b',
            name: '豆干',
            normalizedName: '豆干',
            aliases: [],
            searchText: '豆干',
            energyKcal: 140,
            proteinG: 16.2,
            fatG: 6.2,
            carbohydrateG: 4.5,
            fiberG: 0.5,
            sodiumMg: 80,
          },
          0.67,
        ],
      ],
    });
    const service = new MealIngredientGroundingService(prisma as never);

    const result = await service.groundIngredients([
      {
        dishKey: 'dish-3',
        ingredientName: '豆制品',
        normalizedIngredientName: '豆制品',
        defaultRatio: 1,
        decompositionSource: 'model',
        confidence: 0.7,
      },
    ]);

    expect(result.compositionMatches[0]).toEqual(
      expect.objectContaining({
        ingredientName: '豆制品',
        matchedFoodId: null,
        matchedFoodName: null,
        matchMethod: 'unmatched',
        matchScore: 0,
      }),
    );
    expect(result.coverage).toBe('none');
    expect(result.nutritionEstimate).toBeNull();
  });
});

function buildPrisma(options: {
  exact: Array<Record<string, unknown>>;
  fuzzy: Array<[Record<string, unknown>, number]> | Array<Array<unknown>>;
}): {
  foodCompositionItem: Pick<PrismaService['foodCompositionItem'], 'findMany'>;
} {
  const findMany = jest.fn().mockImplementation(
    (args?: {
      where?: {
        OR?: Array<{
          normalizedName?: { in?: string[] };
          searchText?: { in?: string[] };
        }>;
      };
    }) => {
      const isExactQuery = args?.where?.OR?.every(
        (condition) => typeof condition.normalizedName === 'string',
      );
      if (isExactQuery) {
        return Promise.resolve(options.exact);
      }

      return Promise.resolve(
        (options.fuzzy as Array<[Record<string, unknown>, number]>).map(
          ([item, score]) => ({
            ...item,
            _score: score,
          }),
        ),
      );
    },
  );

  return {
    foodCompositionItem: {
      findMany,
    },
  };
}
