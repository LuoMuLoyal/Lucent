import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeNullableText } from '../../../../common/helpers';
import { EnvKey } from '../../../../config/env-keys.enum';
import {
  DEFAULT_MEAL_HIGH_FAT_THRESHOLD_G,
  DEFAULT_MEAL_HIGH_PROTEIN_THRESHOLD_G,
  DEFAULT_MEAL_LOW_CARBOHYDRATE_THRESHOLD_G,
  DEFAULT_MEAL_PORTION_GRAMS,
  DEFAULT_MEAL_SMALL_PORTION_GRAMS,
} from '../../../../config/constants';
import {
  normalizeMealEntityName,
  type MealCompositionMatch,
  type MealRecognizedDish,
  type MealResolvedIngredient,
} from '../../types/meal-analysis.types';
import { MealDishDecompositionService } from '../meal-dish/decomposition.service';
import { MealIngredientGroundingService } from '../meal-ingredient/grounding.service';

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

/** Thresholds for meal analysis commentary, configurable via environment. */
interface MealAnalysisThresholds {
  defaultPortionGrams: number;
  smallPortionGrams: number;
  highProteinThresholdG: number;
  lowCarbohydrateThresholdG: number;
  highFatThresholdG: number;
}

@Injectable()
export class MealAnalysisMatcherService {
  private readonly thresholds: MealAnalysisThresholds;

  constructor(
    private readonly mealDishDecompositionService: MealDishDecompositionService,
    private readonly mealIngredientGroundingService: MealIngredientGroundingService,
    configService: ConfigService,
  ) {
    this.thresholds = {
      defaultPortionGrams:
        configService.get<number>(EnvKey.MEAL_DEFAULT_PORTION_GRAMS) ??
        DEFAULT_MEAL_PORTION_GRAMS,
      smallPortionGrams:
        configService.get<number>(EnvKey.MEAL_SMALL_PORTION_GRAMS) ??
        DEFAULT_MEAL_SMALL_PORTION_GRAMS,
      highProteinThresholdG:
        configService.get<number>(EnvKey.MEAL_HIGH_PROTEIN_THRESHOLD_G) ??
        DEFAULT_MEAL_HIGH_PROTEIN_THRESHOLD_G,
      lowCarbohydrateThresholdG:
        configService.get<number>(EnvKey.MEAL_LOW_CARBOHYDRATE_THRESHOLD_G) ??
        DEFAULT_MEAL_LOW_CARBOHYDRATE_THRESHOLD_G,
      highFatThresholdG:
        configService.get<number>(EnvKey.MEAL_HIGH_FAT_THRESHOLD_G) ??
        DEFAULT_MEAL_HIGH_FAT_THRESHOLD_G,
    };
  }

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
    const foodItems = buildLegacyFoodItems(
      recognizedItems,
      compositionMatches,
      this.thresholds,
    );
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
        this.thresholds,
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
  thresholds: MealAnalysisThresholds,
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
        match?.matchedFoodId == null
          ? null
          : estimateGrams(item.portionText, thresholds),
    };
  });
}

function estimateGrams(
  portionText: string | null,
  thresholds: MealAnalysisThresholds,
): number | null {
  const normalized = normalizeNullableText(portionText);
  if (normalized == null) {
    return thresholds.defaultPortionGrams;
  }
  if (/\d+\s*克/.test(normalized)) {
    const value = Number(normalized.match(/(\d+)/)?.[1] ?? 0);
    return value > 0 ? value : thresholds.defaultPortionGrams;
  }
  if (normalized.includes('碗') || normalized.includes('份')) {
    return thresholds.defaultPortionGrams;
  }
  if (normalized.includes('少量')) {
    return thresholds.smallPortionGrams;
  }
  return thresholds.defaultPortionGrams;
}

function buildMealCommentary(
  nutritionEstimate: NutritionEstimate | null,
  unmatchedItemCount: number,
  thresholds: MealAnalysisThresholds,
): string | null {
  if (nutritionEstimate == null) {
    return null;
  }

  const parts: string[] = [];
  if (nutritionEstimate.proteinG >= thresholds.highProteinThresholdG) {
    parts.push('这一餐蛋白质较充足');
  }
  if (nutritionEstimate.carbohydrateG < thresholds.lowCarbohydrateThresholdG) {
    parts.push('碳水可能偏少');
  }
  if (nutritionEstimate.fatG >= thresholds.highFatThresholdG) {
    parts.push('油脂可能偏高');
  }
  if (unmatchedItemCount > 0) {
    parts.push('部分食材未命中成分表，营养仅为估算');
  }

  return parts.length > 0
    ? `${parts.join('，')}。`
    : '这一餐营养结果为保守估算。';
}
