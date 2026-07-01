import { Injectable } from '@nestjs/common';
import { normalizeNullableText } from '../../../common/utils/string.utils';
import { PrismaService } from '../../../prisma/prisma.service';

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

@Injectable()
export class MealAnalysisMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async matchAndEstimate(recognizedItems: RecognizedFoodItem[]): Promise<{
    coverage: 'none' | 'partial' | 'complete';
    foodItems: MatchedFoodItem[];
    nutritionEstimate: NutritionEstimate | null;
    mealCommentary: string | null;
    matchDiagnostics: Record<string, unknown> | null;
  }> {
    const candidates = await this.prisma.foodCompositionItem.findMany({
      select: {
        id: true,
        name: true,
        normalizedName: true,
        aliases: true,
        ediblePortionPercent: true,
        energyKcal: true,
        proteinG: true,
        fatG: true,
        carbohydrateG: true,
        fiberG: true,
        sodiumMg: true,
      },
      where: {
        normalizedName: {
          in: recognizedItems
            .map((item) => normalizeFoodKey(item.name))
            .filter((value): value is string => value != null),
        },
      },
    });

    const matchedItems = recognizedItems.map((item) => {
      const normalizedName = normalizeFoodKey(item.name);
      const match =
        normalizedName == null
          ? null
          : (candidates.find((candidate) => {
              if (candidate.normalizedName === normalizedName) {
                return true;
              }

              const aliases = Array.isArray(candidate.aliases)
                ? candidate.aliases.filter(
                    (alias): alias is string => typeof alias === 'string',
                  )
                : [];
              return aliases.includes(normalizedName);
            }) ?? null);

      return {
        name: item.name,
        confidence: item.confidence,
        portionText: item.portionText,
        matchedFoodId: match?.id ?? null,
        matchedFoodName: match?.name ?? null,
        estimatedGrams: match == null ? null : estimateGrams(item.portionText),
        nutrientSource: match,
      };
    });

    const totals = matchedItems.reduce(
      (accumulator, item) => {
        if (
          item.nutrientSource == null ||
          item.estimatedGrams == null ||
          item.estimatedGrams <= 0
        ) {
          return accumulator;
        }

        const ratio = item.estimatedGrams / 100;
        accumulator.energyKcal += (item.nutrientSource.energyKcal ?? 0) * ratio;
        accumulator.proteinG += (item.nutrientSource.proteinG ?? 0) * ratio;
        accumulator.fatG += (item.nutrientSource.fatG ?? 0) * ratio;
        accumulator.carbohydrateG +=
          (item.nutrientSource.carbohydrateG ?? 0) * ratio;
        accumulator.fiberG += (item.nutrientSource.fiberG ?? 0) * ratio;
        accumulator.sodiumMg += (item.nutrientSource.sodiumMg ?? 0) * ratio;
        accumulator.matchedItemCount += 1;
        return accumulator;
      },
      {
        energyKcal: 0,
        proteinG: 0,
        fatG: 0,
        carbohydrateG: 0,
        fiberG: 0,
        sodiumMg: 0,
        matchedItemCount: 0,
      },
    );

    const totalItemCount = matchedItems.length;
    const unmatchedNames = matchedItems
      .filter((item) => item.matchedFoodId == null)
      .map((item) => item.name);
    const unmatchedItemCount = unmatchedNames.length;

    const coverage =
      totalItemCount === 0
        ? 'none'
        : unmatchedItemCount === 0
          ? 'complete'
          : totals.matchedItemCount > 0
            ? 'partial'
            : 'none';

    const nutritionEstimate =
      totals.matchedItemCount === 0
        ? null
        : {
            energyKcal: roundNumber(totals.energyKcal, 0),
            proteinG: roundNumber(totals.proteinG, 1),
            fatG: roundNumber(totals.fatG, 1),
            carbohydrateG: roundNumber(totals.carbohydrateG, 1),
            fiberG: roundNumber(totals.fiberG, 1),
            sodiumMg: roundNumber(totals.sodiumMg, 0),
            matchedItemCount: totals.matchedItemCount,
            totalItemCount,
            unmatchedItemCount,
          };

    return {
      coverage,
      foodItems: matchedItems.map(
        ({ nutrientSource: _source, ...item }) => item,
      ),
      nutritionEstimate,
      mealCommentary: buildMealCommentary(
        nutritionEstimate,
        unmatchedItemCount,
      ),
      matchDiagnostics:
        totalItemCount === 0
          ? null
          : {
              matchedItemCount: totals.matchedItemCount,
              unmatchedNames,
            },
    };
  }
}

function normalizeFoodKey(value: string | null | undefined): string | null {
  const text = normalizeNullableText(value);
  if (text == null) {
    return null;
  }

  return text.replace(/\s+/g, '').replace(/[（(].*?[）)]/g, '');
}

function estimateGrams(portionText: string | null): number | null {
  const normalized = normalizeNullableText(portionText);
  if (normalized == null) {
    return 100;
  }
  if (/\d+\s*克/.test(normalized)) {
    const value = Number(normalized.match(/(\d+)/)?.[1] ?? 0);
    return value > 0 ? value : 100;
  }
  if (normalized.includes('碗') || normalized.includes('份')) {
    return 100;
  }
  if (normalized.includes('少量')) {
    return 30;
  }
  return 100;
}

function roundNumber(value: number, fractionDigits: number): number {
  return Number(value.toFixed(fractionDigits));
}

function buildMealCommentary(
  nutritionEstimate: NutritionEstimate | null,
  unmatchedItemCount: number,
): string | null {
  if (nutritionEstimate == null) {
    return null;
  }

  const parts: string[] = [];
  if (nutritionEstimate.proteinG >= 20) {
    parts.push('这一餐蛋白质较充足');
  }
  if (nutritionEstimate.carbohydrateG < 20) {
    parts.push('碳水可能偏少');
  }
  if (nutritionEstimate.fatG >= 20) {
    parts.push('油脂可能偏高');
  }
  if (unmatchedItemCount > 0) {
    parts.push('部分食物未匹配，营养仅为估算');
  }

  return parts.length > 0
    ? `${parts.join('，')}。`
    : '这一餐营养结果为保守估算。';
}
