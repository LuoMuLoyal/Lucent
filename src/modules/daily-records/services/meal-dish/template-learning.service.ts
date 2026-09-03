import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import { buildSearchText } from '../../../../common/index.js';
import { toInputJsonValue } from '../../../../common/index.js';
import type { MealAnalysisPayload } from '../../types/meal-analysis.types.js';

type MealDishTemplateWriteAccess = PrismaService & {
  mealDishTemplate: {
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  mealDishTemplateIngredient: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
  $transaction: <T>(
    fn: (tx: MealDishTemplateWriteAccess) => Promise<T>,
  ) => Promise<T>;
};

@Injectable()
export class MealDishTemplateLearningService {
  constructor(private readonly prisma: PrismaService) {}

  async learnFromConfirmedAnalysis(
    analysis: MealAnalysisPayload | null | undefined,
  ): Promise<void> {
    if (analysis?.analysisStatus !== 'confirmed') {
      return;
    }

    const recognizedDishes = Array.isArray(analysis.recognizedDishes)
      ? analysis.recognizedDishes
      : [];
    const resolvedIngredients = Array.isArray(analysis.resolvedIngredients)
      ? analysis.resolvedIngredients
      : [];
    const compositionMatches = Array.isArray(analysis.compositionMatches)
      ? analysis.compositionMatches
      : [];

    for (const dish of recognizedDishes) {
      const groundedIngredients = resolvedIngredients
        .filter((ingredient) => ingredient.dishKey === dish.dishKey)
        .map((ingredient) => {
          const match = compositionMatches.find(
            (item) =>
              item.dishKey === dish.dishKey &&
              item.ingredientName === ingredient.ingredientName &&
              item.matchedFoodId != null,
          );
          if (match?.matchedFoodId == null) {
            return null;
          }

          return {
            ingredientName: ingredient.ingredientName,
            normalizedIngredientName: ingredient.normalizedIngredientName,
            foodCompositionItemId: match.matchedFoodId,
            defaultRatio: ingredient.defaultRatio,
          };
        })
        .filter(
          (
            item,
          ): item is {
            ingredientName: string;
            normalizedIngredientName: string;
            foodCompositionItemId: string;
            defaultRatio: number | null;
          } => item != null,
        );

      if (groundedIngredients.length === 0) {
        continue;
      }

      await (this.prisma as MealDishTemplateWriteAccess).$transaction(
        async (tx) => {
          const template = await tx.mealDishTemplate.upsert({
            where: {
              normalizedDishName: dish.normalizedDishName,
            },
            update: {
              displayName: dish.rawName,
              status: 'active',
              source: 'learned',
              searchText: buildSearchText([
                dish.normalizedDishName,
                dish.rawName,
              ]),
            },
            create: {
              normalizedDishName: dish.normalizedDishName,
              displayName: dish.rawName,
              aliases: toInputJsonValue([]),
              status: 'active',
              source: 'learned',
              searchText: buildSearchText([
                dish.normalizedDishName,
                dish.rawName,
              ]),
            },
            select: { id: true },
          });

          await tx.mealDishTemplateIngredient.deleteMany({
            where: { templateId: template.id },
          });

          await tx.mealDishTemplateIngredient.createMany({
            data: groundedIngredients.map((ingredient, index) => ({
              templateId: template.id,
              ingredientName: ingredient.ingredientName,
              normalizedIngredientName: ingredient.normalizedIngredientName,
              foodCompositionItemId: ingredient.foodCompositionItemId,
              defaultRatio: ingredient.defaultRatio,
              sortOrder: index + 1,
            })),
          });
        },
      );
    }
  }
}
