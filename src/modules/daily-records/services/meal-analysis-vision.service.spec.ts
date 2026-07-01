import { SystemMessage } from '@langchain/core/messages';
import type { HumanMessage } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../llm-runtime/services/llm-runtime.service';
import { MealAnalysisVisionService } from './meal-analysis-vision.service';

describe('MealAnalysisVisionService', () => {
  it('invokes the vision role with image input and parses structured JSON', async () => {
    const invoke = jest.fn().mockResolvedValue({
      content:
        '```json\n{"mealDescription":"一份鸡胸肉沙拉","foodItems":[{"name":"鸡胸肉","confidence":0.91,"portionText":"约100克"},{"name":"生菜","confidence":0.83,"portionText":"1份"}]}\n```',
    });
    const createChatModel = jest.fn().mockReturnValue({ invoke });
    const service = new MealAnalysisVisionService({
      hasRoleConfig: jest.fn().mockReturnValue(true),
      createChatModel,
    } as unknown as LlmRuntimeService);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(createChatModel).toHaveBeenCalledWith('vision', {
      temperature: 0.1,
      maxRetries: 0,
    });
    expect(invoke).toHaveBeenCalledWith([
      expect.any(SystemMessage),
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
          }),
          {
            type: 'image_url',
            image_url: {
              url: 'https://cos.example.com/meal.jpg',
            },
          },
        ]),
      } as HumanMessage),
    ]);
    expect(result).toEqual({
      mealDescription: '一份鸡胸肉沙拉',
      foodItems: [
        {
          name: '鸡胸肉',
          confidence: 0.91,
          portionText: '约100克',
        },
        {
          name: '生菜',
          confidence: 0.83,
          portionText: '1份',
        },
      ],
    });
  });

  it('falls back to an empty recognition result when the model response is not parseable JSON', async () => {
    const invoke = jest.fn().mockResolvedValue({
      content: '我看起来像是一顿饭，但我没按要求输出 JSON',
    });
    const service = new MealAnalysisVisionService({
      hasRoleConfig: jest.fn().mockReturnValue(true),
      createChatModel: jest.fn().mockReturnValue({ invoke }),
    } as unknown as LlmRuntimeService);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result).toEqual({
      mealDescription: null,
      foodItems: [],
    });
  });
});
