import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { LlmSafetyPolicyService } from '../../../../common/llm/llm-safety-policy.service';
import { safeParseLlmJson } from '../../../../common';

import { normalizeNullableText } from '../../../../common';
import { LlmRuntimeService } from '../../../../llm-runtime';

const MEAL_DESCRIPTION_MAX_LENGTH = 200;
const FOOD_NAME_MAX_LENGTH = 100;
const PORTION_TEXT_MAX_LENGTH = 100;

export interface MealVisionRecognitionResult {
  mealDescription: string | null;
  foodItems: Array<{
    name: string;
    confidence: number | null;
    portionText: string | null;
  }>;
}

@Injectable()
export class MealAnalysisVisionService {
  private readonly logger = new Logger(MealAnalysisVisionService.name);

  constructor(
    private readonly llmRuntimeService: LlmRuntimeService,
    private readonly safetyPolicyService: LlmSafetyPolicyService,
  ) {}

  isConfigured(): boolean {
    return this.llmRuntimeService.hasRoleConfig('vision');
  }

  recognizeFromImageUrl(
    imageUrl: string,
  ): Promise<MealVisionRecognitionResult> {
    return this.invokeVisionModel(imageUrl);
  }

  private async invokeVisionModel(
    imageUrl: string,
  ): Promise<MealVisionRecognitionResult> {
    const model = this.llmRuntimeService.createChatModel('vision', {
      temperature: 0.1,
      maxRetries: 0,
    });

    const response = await model.invoke([
      new SystemMessage(buildMealVisionSystemPrompt()),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: buildMealVisionUserPrompt(),
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
        ],
      }),
    ]);

    const text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    const parsed = parseRecognitionResponse(text, this.logger);
    if (parsed == null) {
      this.logger.warn('Meal vision response was not parseable JSON');
      return emptyRecognitionResult();
    }

    return this.sanitizeRecognitionResult(parsed);
  }

  private sanitizeRecognitionResult(
    raw: MealVisionRecognitionResult,
  ): MealVisionRecognitionResult {
    const mealDescription = this.sanitizeNullableText(
      raw.mealDescription,
      MEAL_DESCRIPTION_MAX_LENGTH,
      true,
    );

    const foodItems = raw.foodItems
      .map((item) => {
        const name = this.sanitizeText(item.name, FOOD_NAME_MAX_LENGTH);
        if (name == null) {
          return null;
        }

        if (!this.safetyPolicyService.isSafeText(name)) {
          this.logger.warn('Meal vision food name rejected by safety filter');
          return null;
        }

        const portionText = this.sanitizeNullableText(
          item.portionText,
          PORTION_TEXT_MAX_LENGTH,
          false,
        );

        return {
          name,
          confidence: item.confidence,
          portionText,
        };
      })
      .filter(
        (
          item,
        ): item is {
          name: string;
          confidence: number | null;
          portionText: string | null;
        } => item != null,
      );

    if (mealDescription == null && foodItems.length === 0) {
      this.logger.warn(
        'Meal vision result was sanitized to empty; returning empty recognition result',
      );
      return emptyRecognitionResult();
    }

    return { mealDescription, foodItems };
  }

  private sanitizeNullableText(
    raw: string | null,
    maxLength: number,
    dropIfUnsafe: boolean,
  ): string | null {
    const sanitized = this.sanitizeText(raw, maxLength);
    if (sanitized == null) {
      return null;
    }

    if (dropIfUnsafe && !this.safetyPolicyService.isSafeText(sanitized)) {
      return null;
    }

    return sanitized;
  }

  private sanitizeText(raw: string | null, maxLength: number): string | null {
    if (raw == null) {
      return null;
    }

    const withoutScriptBlocks = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const withoutMarkup = withoutScriptBlocks
      .replace(/<[^>]*>/g, '')
      .split('')
      .filter((char) => !isControlCharacter(char))
      .join('');
    const normalized = normalizeNullableText(withoutMarkup);
    if (normalized == null) {
      return null;
    }

    return normalized.length > maxLength
      ? normalized.slice(0, maxLength)
      : normalized;
  }
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code <= 0x08 ||
    (code >= 0x0b && code <= 0x0c) ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
}

function buildMealVisionSystemPrompt(): string {
  return [
    'You are a conservative meal-recognition assistant.',
    'Recognize only visible foods and drinks in the provided meal photo.',
    'Return JSON only.',
    'Do not provide medical advice.',
    'Do not invent hidden ingredients.',
    'Use short normalized Chinese food names when possible.',
  ].join(' ');
}

function buildMealVisionUserPrompt(): string {
  return [
    'Please identify the visible meal.',
    'Return exactly one JSON object with this shape:',
    '{"mealDescription": string|null, "foodItems": [{"name": string, "confidence": number|null, "portionText": string|null}]}',
    'If uncertain, keep the item but lower confidence.',
    'If nothing reliable is visible, return {"mealDescription": null, "foodItems": []}.',
  ].join(' ');
}

function parseRecognitionResponse(
  rawText: string,
  logger: Logger,
): MealVisionRecognitionResult | null {
  const parsed = safeParseLlmJson(rawText, {
    logger,
    context: 'meal vision recognition',
  }) as {
    mealDescription?: unknown;
    foodItems?: unknown;
  } | null;

  if (parsed == null) {
    return null;
  }

  const mealDescription =
    typeof parsed.mealDescription === 'string'
      ? normalizeNullableText(parsed.mealDescription)
      : null;

  const foodItems = Array.isArray(parsed.foodItems)
    ? parsed.foodItems
        .map((item) => {
          if (item == null || typeof item !== 'object') {
            return null;
          }

          const candidate = item as Record<string, unknown>;
          const name = normalizeNullableText(candidate['name']);
          if (name == null) {
            return null;
          }

          return {
            name,
            confidence:
              typeof candidate['confidence'] === 'number'
                ? candidate['confidence']
                : null,
            portionText: normalizeNullableText(candidate['portionText']),
          };
        })
        .filter(
          (
            item,
          ): item is {
            name: string;
            confidence: number | null;
            portionText: string | null;
          } => item != null,
        )
    : [];

  return {
    mealDescription,
    foodItems,
  };
}

function emptyRecognitionResult(): MealVisionRecognitionResult {
  return {
    mealDescription: null,
    foodItems: [],
  };
}
