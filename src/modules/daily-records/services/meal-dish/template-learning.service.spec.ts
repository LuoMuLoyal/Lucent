import type { DeepMocked } from '../../../../common/types/deep-mocked';
import { MealDishTemplateLearningService } from './template-learning.service';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { MealAnalysisPayload } from '../../types/meal-analysis.types';

describe('MealDishTemplateLearningService', () => {
  let service: MealDishTemplateLearningService;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    const txMock = {
      mealDishTemplate: {
        upsert: jest.fn().mockResolvedValue({ id: 'template-1' }),
      },
      mealDishTemplateIngredient: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(txMock),
      ),
    } as unknown as DeepMocked<PrismaService>;

    service = new MealDishTemplateLearningService(prisma);
  });

  describe('learnFromConfirmedAnalysis', () => {
    it('does nothing when analysis is null', async () => {
      await service.learnFromConfirmedAnalysis(null);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does nothing when analysis is undefined', async () => {
      await service.learnFromConfirmedAnalysis(undefined);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does nothing when analysisStatus is not confirmed', async () => {
      const payload: MealAnalysisPayload = { analysisStatus: 'unconfirmed' };
      await service.learnFromConfirmedAnalysis(payload);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does nothing when analysisStatus is analysis_failed', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'analysis_failed',
      };
      await service.learnFromConfirmedAnalysis(payload);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips when no recognized dishes', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [],
        resolvedIngredients: [],
        compositionMatches: [],
      };
      await service.learnFromConfirmedAnalysis(payload);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips when recognizedDishes is not an array', async () => {
      const payload = {
        analysisStatus: 'confirmed',
        recognizedDishes: null,
        resolvedIngredients: [],
        compositionMatches: [],
      } as unknown as MealAnalysisPayload;
      await service.learnFromConfirmedAnalysis(payload);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips dish when no grounded ingredients', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '炒饭',
            normalizedDishName: 'cha_fan',
            confidence: 0.9,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: [],
        compositionMatches: [],
      };
      await service.learnFromConfirmedAnalysis(payload);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('skips ingredient when matchedFoodId is null', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '炒饭',
            normalizedDishName: 'cha_fan',
            confidence: 0.9,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            normalizedIngredientName: 'mi_fan',
            defaultRatio: 1.0,
            decompositionSource: 'template',
            confidence: 0.8,
          },
        ],
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: null,
            matchedFoodName: null,
            matchMethod: 'unmatched',
            matchScore: 0,
          },
        ],
      };
      await service.learnFromConfirmedAnalysis(payload);
      // No grounded ingredients -> no transaction
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('learns template when dish has grounded ingredients', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '炒饭',
            normalizedDishName: 'cha_fan',
            confidence: 0.9,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            normalizedIngredientName: 'mi_fan',
            defaultRatio: 1.0,
            decompositionSource: 'template',
            confidence: 0.8,
          },
          {
            dishKey: 'dish-1',
            ingredientName: '鸡蛋',
            normalizedIngredientName: 'ji_dan',
            defaultRatio: 0.3,
            decompositionSource: 'model',
            confidence: 0.7,
          },
        ],
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: 'food-rice-001',
            matchedFoodName: '米饭',
            matchMethod: 'exact',
            matchScore: 1.0,
          },
          {
            dishKey: 'dish-1',
            ingredientName: '鸡蛋',
            matchedFoodId: 'food-egg-002',
            matchedFoodName: '鸡蛋',
            matchMethod: 'exact',
            matchScore: 1.0,
          },
        ],
      };

      await service.learnFromConfirmedAnalysis(payload);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('handles multiple dishes in a single analysis', async () => {
      const payload: MealAnalysisPayload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '炒饭',
            normalizedDishName: 'cha_fan',
            confidence: 0.9,
            portionText: null,
            source: 'vision',
          },
          {
            dishKey: 'dish-2',
            rawName: '炒面',
            normalizedDishName: 'chao_mian',
            confidence: 0.85,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            normalizedIngredientName: 'mi_fan',
            defaultRatio: 1.0,
            decompositionSource: 'template',
            confidence: 0.8,
          },
          {
            dishKey: 'dish-2',
            ingredientName: '面条',
            normalizedIngredientName: 'mian_tiao',
            defaultRatio: 1.0,
            decompositionSource: 'template',
            confidence: 0.8,
          },
        ],
        compositionMatches: [
          {
            dishKey: 'dish-1',
            ingredientName: '米饭',
            matchedFoodId: 'food-rice-001',
            matchedFoodName: '米饭',
            matchMethod: 'exact',
            matchScore: 1.0,
          },
          {
            dishKey: 'dish-2',
            ingredientName: '面条',
            matchedFoodId: 'food-noodle-003',
            matchedFoodName: '面条',
            matchMethod: 'exact',
            matchScore: 1.0,
          },
        ],
      };

      await service.learnFromConfirmedAnalysis(payload);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('handles non-array resolvedIngredients gracefully', async () => {
      const payload = {
        analysisStatus: 'confirmed',
        recognizedDishes: [
          {
            dishKey: 'dish-1',
            rawName: '炒饭',
            normalizedDishName: 'cha_fan',
            confidence: 0.9,
            portionText: null,
            source: 'vision',
          },
        ],
        resolvedIngredients: null,
        compositionMatches: null,
      } as unknown as MealAnalysisPayload;

      await service.learnFromConfirmedAnalysis(payload);
      // No ingredients to ground -> no transaction
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
