import { Injectable } from '@nestjs/common';
import { normalizeNullableText } from '../../../common/helpers/string.utils';
import {
  normalizeMealEntityName,
  type MealCompositionMatch,
  type MealRecognizedDish,
  type MealResolvedIngredient,
} from '../types/meal-analysis.types';
import { MealDishDecompositionService } from './meal-dish-decomposition.service';
import { MealIngredientGroundingService } from './meal-ingredient-grounding.service';

interface RecognizedFoodItem {
  name: string;
  confidence: number | null;
  portionText: string | null;
}

interface MatchedFoodItem extends RecognizedFoodItem {
  matchedFoodId: string | null;
  matchedFoodName: string | null;
  estimatedGrams: number | null;
}

interface NutritionEstimate {
  energyKcal: number;
  proteinG: number;
  fatG: number;
  carbohydrateG: number;
  fiberG: number;
  sodiumMg: number;
  matchedItemCount: number;
  totalItemCount: number;
  unmatchedItemCount: number;
}

// TODO: move meal analysis business thresholds to configuration (env or
// database) so they can be tuned without a code deployment.
const DEFAULT_PORTION_GRAMS = 100;
const SMALL_PORTION_GRAMS = 30;
const HIGH_PROTEIN_THRESHOLD_G = 20;
const LOW_CARBOHYDRATE_THRESHOLD_G = 20;
const HIGH_FAT_THRESHOLD_G = 20;

@Injectable()
export class MealAnalysisMatcherService {
  constructor(
    private readonly mealDishDecompositionService: MealDishDecompositionService,
    private readonly mealIngredientGroundingService: MealIngredientGroundingService,
  ) {}

  async matchAndEstimate(recognizedItems: RecognizedFoodItem[]): Promise<{
    coverage: 'none' | 'partial' | 'complete';
    foodItems: MatchedFoodItem[];
    recognizedDishes: MealRecognizedDish[];
    resolvedIngredients: MealResolvedIngredient[];
    compositionMatches: MealCompositionMatch[];
    nutritionEstimate: NutritionEstimate | null;
    mealCommentary: string | null;
    matchDiagnostics: Record<string, unknown> | null;
  }> {
    const recognizedDishes = recognizedItems
      .map((item, index) => {
        const normalizedDishName = normalizeMealEntityName(item.name);
        if (normalizedDishName == null) {
          return null;
        }

        return {
          dishKey: `dish-${String(index + 1)}`,
          rawName: item.name,
          normalizedDishName,
          confidence: item.confidence,
          portionText: item.portionText,
          source: 'vision' as const,
        };
      })
      .filter((item): item is MealRecognizedDish => item != null);

    const decomposition =
      await this.mealDishDecompositionService.resolveRecognizedDishes(
        recognizedDishes,
      );
    const grounded =
      await this.mealIngredientGroundingService.groundIngredients(
        decomposition.resolvedIngredients,
      );
    const compositionMatches = grounded.compositionMatches;
    const foodItems = buildLegacyFoodItems(recognizedItems, compositionMatches);
    const nutritionEstimate = grounded.nutritionEstimate;
    const unresolvedDishNames = decomposition.unresolvedDishes.map(
      (item) => item.rawName,
    );
    const unmatchedIngredientNames = compositionMatches
      .filter((item) => item.matchedFoodId == null)
      .map((item) => item.ingredientName);

    return {
      coverage: grounded.coverage,
      foodItems,
      recognizedDishes: decomposition.recognizedDishes,
      resolvedIngredients: decomposition.resolvedIngredients,
      compositionMatches,
      nutritionEstimate,
      mealCommentary: buildMealCommentary(
        nutritionEstimate,
        unmatchedIngredientNames.length,
      ),
      matchDiagnostics:
        recognizedDishes.length === 0 &&
        decomposition.resolvedIngredients.length === 0 &&
        compositionMatches.length === 0
          ? null
          : {
              matchedItemCount: nutritionEstimate?.matchedItemCount ?? 0,
              unmatchedNames: unmatchedIngredientNames,
              unresolvedDishNames,
            },
    };
  }
}

function buildLegacyFoodItems(
  recognizedItems: RecognizedFoodItem[],
  compositionMatches: MealCompositionMatch[],
): MatchedFoodItem[] {
  return recognizedItems.map((item, index) => {
    const dishKey = `dish-${String(index + 1)}`;
    const match = compositionMatches.find(
      (candidate) => candidate.dishKey === dishKey,
    );

    return {
      name: item.name,
      confidence: item.confidence,
      portionText: item.portionText,
      matchedFoodId: match?.matchedFoodId ?? null,
      matchedFoodName: match?.matchedFoodName ?? null,
      estimatedGrams:
        match?.matchedFoodId == null ? null : estimateGrams(item.portionText),
    };
  });
}

function estimateGrams(portionText: string | null): number | null {
  const normalized = normalizeNullableText(portionText);
  if (normalized == null) {
    return DEFAULT_PORTION_GRAMS;
  }
  if (/\d+\s*克/.test(normalized)) {
    const value = Number(normalized.match(/(\d+)/)?.[1] ?? 0);
    return value > 0 ? value : DEFAULT_PORTION_GRAMS;
  }
  if (normalized.includes('碗') || normalized.includes('份')) {
    return DEFAULT_PORTION_GRAMS;
  }
  if (normalized.includes('少量')) {
    return SMALL_PORTION_GRAMS;
  }
  return DEFAULT_PORTION_GRAMS;
}

function buildMealCommentary(
  nutritionEstimate: NutritionEstimate | null,
  unmatchedItemCount: number,
): string | null {
  if (nutritionEstimate == null) {
    return null;
  }

  const parts: string[] = [];
  if (nutritionEstimate.proteinG >= HIGH_PROTEIN_THRESHOLD_G) {
    parts.push('这一餐蛋白质较充足');
  }
  if (nutritionEstimate.carbohydrateG < LOW_CARBOHYDRATE_THRESHOLD_G) {
    parts.push('碳水可能偏少');
  }
  if (nutritionEstimate.fatG >= HIGH_FAT_THRESHOLD_G) {
    parts.push('油脂可能偏高');
  }
  if (unmatchedItemCount > 0) {
    parts.push('部分食材未命中成分表，营养仅为估算');
  }

  return parts.length > 0
    ? `${parts.join('，')}。`
    : '这一餐营养结果为保守估算。';
}
