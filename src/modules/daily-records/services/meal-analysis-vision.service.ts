import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { extractJsonObject } from '../../../common/utils/json.utils';
import { normalizeNullableText } from '../../../common/utils/string.utils';
import { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';

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

  constructor(private readonly llmRuntimeService: LlmRuntimeService) {}

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

    return parsed;
  }
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
  try {
    const jsonText = extractJsonObject(rawText);
    if (jsonText == null) {
      return null;
    }

    const parsed = JSON.parse(jsonText) as {
      mealDescription?: unknown;
      foodItems?: unknown;
    };

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
  } catch (error) {
    logger.warn(
      `Failed to parse meal vision response: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function emptyRecognitionResult(): MealVisionRecognitionResult {
  return {
    mealDescription: null,
    foodItems: [],
  };
}
