import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { type Prisma } from '#generated/prisma/client';
import { extractJsonObject } from '../../../common/utils/json.utils';
import { buildSearchText } from '../../../common/utils/search-text.utils';
import { normalizeNullableNumber } from '../../../common/utils/number.utils';
import { normalizeNullableText } from '../../../common/utils/string.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';
import {
  normalizeMealEntityName,
  type MealRecognizedDish,
  type MealResolvedIngredient,
} from '../types/meal-analysis.types';

interface ResolveRecognizedDishesResult {
  recognizedDishes: MealRecognizedDish[];
  resolvedIngredients: MealResolvedIngredient[];
  unresolvedDishes: Array<{
    dishKey: string;
    rawName: string;
    normalizedDishName: string;
    reason: 'decomposition_failed';
  }>;
}

type DishTemplateWithIngredients = Prisma.MealDishTemplateGetPayload<{
  include: { ingredients: true };
}>;

@Injectable()
export class MealDishDecompositionService {
  private readonly logger = new Logger(MealDishDecompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmRuntimeService: LlmRuntimeService,
  ) {}

  async resolveRecognizedDishes(
    recognizedDishes: MealRecognizedDish[],
  ): Promise<ResolveRecognizedDishesResult> {
    if (recognizedDishes.length === 0) {
      return {
        recognizedDishes: [],
        resolvedIngredients: [],
        unresolvedDishes: [],
      };
    }

    const normalizedNames = recognizedDishes
      .map((item) => item.normalizedDishName)
      .filter((item, index, array) => array.indexOf(item) === index);
    const templates = await this.prisma.mealDishTemplate.findMany({
      where: {
        status: 'active',
        OR: [
          {
            normalizedDishName: {
              in: normalizedNames,
            },
          },
          {
            searchText: {
              in: normalizedNames
                .map((name) => buildSearchText([name]))
                .filter((text): text is string => text != null),
            },
          },
        ],
      },
      include: {
        ingredients: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const resolvedIngredients: MealResolvedIngredient[] = [];
    const unresolvedDishes: ResolveRecognizedDishesResult['unresolvedDishes'] =
      [];

    for (const dish of recognizedDishes) {
      const template =
        templates.find((candidate: DishTemplateWithIngredients) => {
          if (candidate.normalizedDishName === dish.normalizedDishName) {
            return true;
          }

          const aliases = Array.isArray(candidate.aliases)
            ? candidate.aliases.filter(
                (alias: unknown): alias is string => typeof alias === 'string',
              )
            : [];
          return aliases.includes(dish.normalizedDishName);
        }) ?? null;

      if (template != null) {
        resolvedIngredients.push(
          ...template.ingredients.map((ingredient) => ({
            dishKey: dish.dishKey,
            ingredientName: ingredient.ingredientName,
            normalizedIngredientName: ingredient.normalizedIngredientName,
            defaultRatio: ingredient.defaultRatio ?? null,
            decompositionSource: 'template' as const,
            confidence: 1,
          })),
        );
        continue;
      }

      const modelResult = await this.resolveDishByModel(dish);
      if (modelResult == null) {
        unresolvedDishes.push({
          dishKey: dish.dishKey,
          rawName: dish.rawName,
          normalizedDishName: dish.normalizedDishName,
          reason: 'decomposition_failed',
        });
        continue;
      }

      resolvedIngredients.push(
        ...modelResult.ingredients.map((ingredient) => ({
          dishKey: dish.dishKey,
          ingredientName: ingredient.ingredientName,
          normalizedIngredientName: ingredient.normalizedIngredientName,
          defaultRatio: ingredient.defaultRatio,
          decompositionSource: 'model' as const,
          confidence: ingredient.confidence,
        })),
      );
    }

    return {
      recognizedDishes,
      resolvedIngredients,
      unresolvedDishes,
    };
  }

  private async resolveDishByModel(dish: MealRecognizedDish): Promise<{
    normalizedDishName: string;
    ingredients: Array<{
      ingredientName: string;
      normalizedIngredientName: string;
      defaultRatio: number | null;
      confidence: number | null;
    }>;
  } | null> {
    if (!this.llmRuntimeService.hasRoleConfig('language')) {
      return null;
    }

    const model = this.llmRuntimeService.createChatModel('language', {
      temperature: 0.1,
      maxRetries: 0,
    });
    const response = await model.invoke([
      new SystemMessage(buildMealDishDecompositionSystemPrompt()),
      new HumanMessage(buildMealDishDecompositionUserPrompt(dish)),
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    const parsed = parseDecompositionResponse(text, this.logger);
    if (parsed == null) {
      this.logger.warn(
        `Meal dish decomposition response was not parseable JSON: ${dish.rawName}`,
      );
    }
    return parsed;
  }
}

function buildMealDishDecompositionSystemPrompt(): string {
  return [
    'You are a conservative Chinese cooked-dish decomposition assistant.',
    'Input is one normalized Chinese dish name recognized from a meal image.',
    'Return JSON only.',
    'Decompose the dish into likely core ingredients only.',
    'Do not output seasonings, oil, salt, soy sauce, or invisible micro ingredients unless essential to the dish identity.',
    'Use short normalized Chinese ingredient names.',
  ].join(' ');
}

function buildMealDishDecompositionUserPrompt(
  dish: MealRecognizedDish,
): string {
  return [
    'Please decompose this recognized dish into core ingredients.',
    `Dish name: ${dish.normalizedDishName}`,
    'Return exactly one JSON object with this shape:',
    '{"normalizedDishName": string, "ingredients": [{"ingredientName": string, "normalizedIngredientName": string, "defaultRatio": number|null, "confidence": number|null}]}',
    'defaultRatio should be between 0 and 1 when available.',
    'If uncertain, still return likely ingredients but lower confidence.',
  ].join(' ');
}

function parseDecompositionResponse(
  rawText: string,
  logger: Logger,
): {
  normalizedDishName: string;
  ingredients: Array<{
    ingredientName: string;
    normalizedIngredientName: string;
    defaultRatio: number | null;
    confidence: number | null;
  }>;
} | null {
  try {
    const jsonText = extractJsonObject(rawText);
    if (jsonText == null) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as {
      normalizedDishName?: unknown;
      ingredients?: unknown;
    };
    const normalizedDishName = normalizeMealEntityName(
      normalizeNullableText(parsed.normalizedDishName),
    );
    if (normalizedDishName == null || !Array.isArray(parsed.ingredients)) {
      return null;
    }

    const ingredients = parsed.ingredients
      .map((item) => {
        if (item == null || typeof item !== 'object') {
          return null;
        }
        const candidate = item as Record<string, unknown>;
        const ingredientName = normalizeNullableText(
          candidate['ingredientName'],
        );
        const normalizedIngredientName = normalizeMealEntityName(
          normalizeNullableText(candidate['normalizedIngredientName']) ??
            ingredientName,
        );
        if (ingredientName == null || normalizedIngredientName == null) {
          return null;
        }

        return {
          ingredientName,
          normalizedIngredientName,
          defaultRatio: normalizeNullableNumber(candidate['defaultRatio']),
          confidence: normalizeNullableNumber(candidate['confidence']),
        };
      })
      .filter(
        (
          item,
        ): item is {
          ingredientName: string;
          normalizedIngredientName: string;
          defaultRatio: number | null;
          confidence: number | null;
        } => item != null,
      );

    if (ingredients.length === 0) {
      return null;
    }

    return {
      normalizedDishName,
      ingredients,
    };
  } catch (error) {
    logger.warn(
      `Failed to parse meal dish decomposition response: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
