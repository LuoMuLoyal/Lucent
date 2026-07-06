import { Injectable } from '@nestjs/common';
import { roundNumber } from '../../../../common/helpers/number.utils';
import { commonCharacterCount } from '../../../../common/helpers/string.utils';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  type MealCompositionMatch,
  type MealResolvedIngredient,
} from '../../types/meal-analysis.types';

interface GroundedIngredient extends MealCompositionMatch {
  nutritionSource: {
    energyKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbohydrateG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  } | null;
}

interface GroundingResult {
  coverage: 'none' | 'partial' | 'complete';
  compositionMatches: MealCompositionMatch[];
  nutritionEstimate: {
    energyKcal: number;
    proteinG: number;
    fatG: number;
    carbohydrateG: number;
    fiberG: number;
    sodiumMg: number;
    matchedItemCount: number;
    totalItemCount: number;
    unmatchedItemCount: number;
  } | null;
}

// TODO: move fuzzy matching thresholds to configuration (env or database) so
// they can be tuned without a code deployment.
const FUZZY_ACCEPT_SCORE = 0.7;
const FUZZY_MIN_LEAD = 0.1;
const FUZZY_QUERY_PREFIX_LENGTH = 1;

@Injectable()
export class MealIngredientGroundingService {
  constructor(private readonly prisma: PrismaService) {}

  async groundIngredients(
    ingredients: MealResolvedIngredient[],
  ): Promise<GroundingResult> {
    if (ingredients.length === 0) {
      return {
        coverage: 'none',
        compositionMatches: [],
        nutritionEstimate: null,
      };
    }

    const exactCandidates = await this.prisma.foodCompositionItem.findMany({
      where: {
        OR: ingredients.map((ingredient) => ({
          normalizedName: ingredient.normalizedIngredientName,
        })),
      },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        aliases: true,
        searchText: true,
        energyKcal: true,
        proteinG: true,
        fatG: true,
        carbohydrateG: true,
        fiberG: true,
        sodiumMg: true,
      },
    });

    const matches: GroundedIngredient[] = [];
    for (const ingredient of ingredients) {
      const exactMatch =
        exactCandidates.find(
          (candidate) =>
            candidate.normalizedName === ingredient.normalizedIngredientName,
        ) ?? null;
      if (exactMatch != null) {
        matches.push(toGroundedIngredient(ingredient, exactMatch, 'exact', 1));
        continue;
      }

      const aliasMatch =
        exactCandidates.find((candidate) => {
          const aliases = Array.isArray(candidate.aliases)
            ? candidate.aliases.filter(
                (alias): alias is string => typeof alias === 'string',
              )
            : [];
          return aliases.includes(ingredient.normalizedIngredientName);
        }) ?? null;
      if (aliasMatch != null) {
        matches.push(toGroundedIngredient(ingredient, aliasMatch, 'alias', 1));
        continue;
      }

      const fuzzyPrefix = ingredient.normalizedIngredientName.slice(
        0,
        FUZZY_QUERY_PREFIX_LENGTH,
      );
      const fuzzyCandidates = await this.prisma.foodCompositionItem.findMany({
        where: {
          OR: [
            { normalizedName: { startsWith: fuzzyPrefix } },
            { searchText: { startsWith: fuzzyPrefix } },
          ],
        },
        take: 5,
        select: {
          id: true,
          name: true,
          normalizedName: true,
          aliases: true,
          searchText: true,
          energyKcal: true,
          proteinG: true,
          fatG: true,
          carbohydrateG: true,
          fiberG: true,
          sodiumMg: true,
        },
      });
      const ranked = fuzzyCandidates
        .map((candidate) => ({
          candidate,
          score: scoreCandidate(
            ingredient.normalizedIngredientName,
            candidate.normalizedName,
            candidate.searchText,
          ),
        }))
        .sort((left, right) => right.score - left.score);
      const top = ranked[0];
      const second = ranked[1];
      if (
        top != null &&
        top.score >= FUZZY_ACCEPT_SCORE &&
        top.score - (second?.score ?? 0) >= FUZZY_MIN_LEAD
      ) {
        matches.push(
          toGroundedIngredient(
            ingredient,
            top.candidate,
            'fuzzy',
            roundNumber(top.score, 2),
          ),
        );
        continue;
      }

      matches.push({
        dishKey: ingredient.dishKey,
        ingredientName: ingredient.ingredientName,
        matchedFoodId: null,
        matchedFoodName: null,
        matchMethod: 'unmatched',
        matchScore: 0,
        nutritionSource: null,
      });
    }

    const matchedItems = matches.filter((item) => item.nutritionSource != null);
    const totalItemCount = matches.length;
    const unmatchedItemCount = totalItemCount - matchedItems.length;
    const coverage =
      totalItemCount === 0
        ? 'none'
        : matchedItems.length === 0
          ? 'none'
          : unmatchedItemCount === 0
            ? 'complete'
            : 'partial';
    const nutritionEstimate =
      matchedItems.length === 0
        ? null
        : {
            energyKcal: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.energyKcal ?? 0),
                0,
              ),
              0,
            ),
            proteinG: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.proteinG ?? 0),
                0,
              ),
              1,
            ),
            fatG: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.fatG ?? 0),
                0,
              ),
              1,
            ),
            carbohydrateG: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.carbohydrateG ?? 0),
                0,
              ),
              1,
            ),
            fiberG: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.fiberG ?? 0),
                0,
              ),
              1,
            ),
            sodiumMg: roundNumber(
              matchedItems.reduce(
                (sum, item) => sum + (item.nutritionSource?.sodiumMg ?? 0),
                0,
              ),
              0,
            ),
            matchedItemCount: matchedItems.length,
            totalItemCount,
            unmatchedItemCount,
          };

    return {
      coverage,
      compositionMatches: matches.map(
        ({ nutritionSource: _source, ...item }) => item,
      ),
      nutritionEstimate,
    };
  }
}

function toGroundedIngredient(
  ingredient: MealResolvedIngredient,
  candidate: {
    id: string;
    name: string;
    energyKcal: number | null;
    proteinG: number | null;
    fatG: number | null;
    carbohydrateG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  },
  matchMethod: 'exact' | 'alias' | 'fuzzy',
  matchScore: number,
): GroundedIngredient {
  return {
    dishKey: ingredient.dishKey,
    ingredientName: ingredient.ingredientName,
    matchedFoodId: candidate.id,
    matchedFoodName: candidate.name,
    matchMethod,
    matchScore,
    nutritionSource: {
      energyKcal: candidate.energyKcal,
      proteinG: candidate.proteinG,
      fatG: candidate.fatG,
      carbohydrateG: candidate.carbohydrateG,
      fiberG: candidate.fiberG,
      sodiumMg: candidate.sodiumMg,
    },
  };
}

function scoreCandidate(
  normalizedIngredientName: string,
  normalizedName: string,
  searchText: string | null,
): number {
  if (normalizedIngredientName === normalizedName) {
    return 1;
  }

  if (searchText?.includes(normalizedIngredientName)) {
    return 0.82;
  }

  const longestCommonLength = commonCharacterCount(
    normalizedIngredientName,
    normalizedName,
  );
  const denominator = Math.max(
    normalizedIngredientName.length,
    normalizedName.length,
    1,
  );
  return longestCommonLength / denominator;
}
