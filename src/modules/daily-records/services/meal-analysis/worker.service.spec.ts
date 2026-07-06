import type { PrismaService } from '../../../../prisma/prisma.service';
import type { DailyRecordImageUploadRuntime } from '../../config/daily-record-image-upload.runtime';
import type { MealAnalysisMatcherService } from '../meal-analysis/matcher.service';
import type { MealAnalysisVisionService } from '../meal-analysis/vision.service';
import { MealAnalysisWorkerService } from '../meal-analysis/worker.service';

describe('MealAnalysisWorkerService', () => {
  it('marks stale jobs as no-op when source revision no longer matches', async () => {
    const prisma = buildPrisma({
      record: {
        id: 'r1',
        userId: 'u1',
        kind: 'meal',
        mealSourceRevision: 3,
        deletedAt: null,
        payload: {
          mealAnalysis: {
            sourceRevision: 3,
            analysisStatus: 'analyzing',
            imageObjectKey: 'daily-records/u1/meal.jpg',
          },
        },
        attachments: [
          {
            objectKey: 'daily-records/u1/meal.jpg',
          },
        ],
      },
    });
    const service = new MealAnalysisWorkerService(
      prisma as never,
      buildVisionService({ configured: true }) as never,
      buildUploadRuntime() as never,
      buildMatcherService() as never,
    );

    await service.process({
      userId: 'u1',
      recordId: 'r1',
      sourceRevision: 2,
    });

    expect(prisma.userDailyRecord.update).not.toHaveBeenCalled();
  });

  it('marks the record as analysis_failed when exactly one image is not available', async () => {
    const prisma = buildPrisma({
      record: {
        id: 'r2',
        userId: 'u1',
        kind: 'meal',
        mealSourceRevision: 1,
        deletedAt: null,
        payload: {
          mealAnalysis: {
            sourceRevision: 1,
            analysisStatus: 'analyzing',
            imageObjectKey: 'daily-records/u1/meal-2.jpg',
          },
        },
        attachments: [],
      },
    });
    const service = new MealAnalysisWorkerService(
      prisma as never,
      buildVisionService({ configured: true }) as never,
      buildUploadRuntime() as never,
      buildMatcherService() as never,
    );

    await service.process({
      userId: 'u1',
      recordId: 'r2',
      sourceRevision: 1,
    });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r2' },
      data: expect.objectContaining({
        mealAnalysisStatus: 'analysis_failed',
        mealAnalysisFailureReason:
          'Meal analysis requires exactly one image attachment.',
      }),
    });
  });

  it('marks the record as analysis_failed when the vision model is not configured', async () => {
    const prisma = buildPrisma({
      record: {
        id: 'r3',
        userId: 'u1',
        kind: 'meal',
        mealSourceRevision: 1,
        deletedAt: null,
        payload: {
          mealAnalysis: {
            sourceRevision: 1,
            analysisStatus: 'analyzing',
            imageObjectKey: 'daily-records/u1/meal-3.jpg',
          },
        },
        attachments: [
          {
            objectKey: 'daily-records/u1/meal-3.jpg',
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
      },
    });
    const service = new MealAnalysisWorkerService(
      prisma as never,
      buildVisionService({ configured: false }) as never,
      buildUploadRuntime() as never,
      buildMatcherService() as never,
    );

    await service.process({
      userId: 'u1',
      recordId: 'r3',
      sourceRevision: 1,
    });

    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r3' },
      data: expect.objectContaining({
        mealAnalysisStatus: 'analysis_failed',
        mealAnalysisFailureReason:
          'Meal analysis vision model is not configured.',
      }),
    });
  });

  it('writes an unconfirmed meal analysis result after successful vision recognition', async () => {
    const prisma = buildPrisma({
      record: {
        id: 'r4',
        userId: 'u1',
        kind: 'meal',
        mealSourceRevision: 2,
        deletedAt: null,
        payload: {
          mealInput: {
            note: '午饭',
          },
          mealAnalysis: {
            sourceRevision: 2,
            analysisStatus: 'analyzing',
            coverage: 'none',
            imageObjectKey: 'daily-records/u1/meal-4.jpg',
          },
        },
        attachments: [
          {
            objectKey: 'daily-records/u1/meal-4.jpg',
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
      },
    });
    const vision = buildVisionService({
      configured: true,
      result: {
        mealDescription: '一份米饭配西兰花和鸡胸肉',
        foodItems: [
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
        ],
      },
    });
    const uploadRuntime = buildUploadRuntime();
    const matcher = buildMatcherService({
      result: {
        coverage: 'partial',
        foodItems: [
          {
            name: '米饭',
            confidence: 0.93,
            portionText: '1碗',
            matchedFoodId: 'food-rice',
            matchedFoodName: '米饭',
            estimatedGrams: 100,
          },
          {
            name: '鸡胸肉',
            confidence: 0.89,
            portionText: '约100克',
            matchedFoodId: 'food-chicken',
            matchedFoodName: '鸡胸肉',
            estimatedGrams: 100,
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
          totalItemCount: 2,
          unmatchedItemCount: 0,
        },
        mealCommentary: '这一餐蛋白质较充足，但蔬菜信息仍不完整。',
        matchDiagnostics: {
          matchedItemCount: 2,
          unmatchedNames: [],
        },
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
        ],
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
        ],
      },
    });
    const service = new MealAnalysisWorkerService(
      prisma as never,
      vision as never,
      uploadRuntime as never,
      matcher as never,
    );

    await service.process({
      userId: 'u1',
      recordId: 'r4',
      sourceRevision: 2,
    });

    expect(uploadRuntime.createSignedGetUrl).toHaveBeenCalledWith(
      'daily-records/u1/meal-4.jpg',
    );
    expect(vision.recognizeFromImageUrl).toHaveBeenCalledWith(
      'https://cos.example.com/signed-meal-4.jpg',
    );
    expect(matcher.matchAndEstimate).toHaveBeenCalledWith([
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
    ]);
    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith({
      where: { id: 'r4' },
      data: expect.objectContaining({
        mealAnalysisStatus: 'unconfirmed',
        mealAnalysisCoverage: 'partial',
        mealAnalysisFailureReason: null,
        mealAnalysisUpdatedAt: expect.any(Date),
      }),
    });
    expect(prisma.userDailyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            mealInput: {
              note: '午饭',
            },
            mealAnalysis: expect.objectContaining({
              analysisStatus: 'unconfirmed',
              coverage: 'partial',
              mealDescription: '一份米饭配西兰花和鸡胸肉',
              foodItems: [
                {
                  name: '米饭',
                  confidence: 0.93,
                  portionText: '1碗',
                  matchedFoodId: 'food-rice',
                  matchedFoodName: '米饭',
                  estimatedGrams: 100,
                },
                {
                  name: '鸡胸肉',
                  confidence: 0.89,
                  portionText: '约100克',
                  matchedFoodId: 'food-chicken',
                  matchedFoodName: '鸡胸肉',
                  estimatedGrams: 100,
                },
              ],
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
              ],
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
              ],
              nutritionEstimate: {
                energyKcal: 249,
                proteinG: 22,
                fatG: 5.3,
                carbohydrateG: 25.9,
                fiberG: 0.3,
                sodiumMg: 48,
                matchedItemCount: 2,
                totalItemCount: 2,
                unmatchedItemCount: 0,
              },
              mealCommentary: '这一餐蛋白质较充足，但蔬菜信息仍不完整。',
              matchDiagnostics: {
                matchedItemCount: 2,
                unmatchedNames: [],
              },
              failureReason: null,
              imageObjectKey: 'daily-records/u1/meal-4.jpg',
              sourceRevision: 2,
              analyzedAt: expect.any(String),
            }),
          }),
        }),
      }),
    );
  });
});

function buildPrisma(options: {
  record: Record<string, unknown> | null;
}): jest.Mocked<Pick<PrismaService, 'userDailyRecord'>> {
  return {
    userDailyRecord: {
      findFirst: jest.fn().mockResolvedValue(options.record),
      update: jest.fn().mockResolvedValue(options.record),
    },
  } as unknown as jest.Mocked<Pick<PrismaService, 'userDailyRecord'>>;
}

function buildVisionService(options: {
  configured: boolean;
  result?: {
    mealDescription: string | null;
    foodItems: Array<{
      name: string;
      confidence: number | null;
      portionText: string | null;
    }>;
  };
}): Pick<MealAnalysisVisionService, 'isConfigured' | 'recognizeFromImageUrl'> {
  return {
    isConfigured: jest.fn().mockReturnValue(options.configured),
    recognizeFromImageUrl: jest.fn().mockResolvedValue(
      options.result ?? {
        mealDescription: null,
        foodItems: [],
      },
    ),
  };
}

function buildUploadRuntime(): Pick<
  DailyRecordImageUploadRuntime,
  'createSignedGetUrl'
> {
  return {
    createSignedGetUrl: jest
      .fn()
      .mockReturnValue('https://cos.example.com/signed-meal-4.jpg'),
  };
}

function buildMatcherService(options?: {
  result?: {
    coverage: 'none' | 'partial' | 'complete';
    foodItems: Array<Record<string, unknown>>;
    nutritionEstimate: Record<string, unknown> | null;
    mealCommentary: string | null;
    matchDiagnostics: Record<string, unknown> | null;
    recognizedDishes?: Array<Record<string, unknown>>;
    resolvedIngredients?: Array<Record<string, unknown>>;
    compositionMatches?: Array<Record<string, unknown>>;
  };
}): Pick<MealAnalysisMatcherService, 'matchAndEstimate'> {
  return {
    matchAndEstimate: jest.fn().mockResolvedValue(
      options?.result ?? {
        coverage: 'none',
        foodItems: [],
        nutritionEstimate: null,
        mealCommentary: null,
        matchDiagnostics: null,
        recognizedDishes: [],
        resolvedIngredients: [],
        compositionMatches: [],
      },
    ),
  };
}
