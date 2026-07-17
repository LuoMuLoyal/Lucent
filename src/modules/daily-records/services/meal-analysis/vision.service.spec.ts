import { SystemMessage } from '@langchain/core/messages';
import type { HumanMessage } from '@langchain/core/messages';
import { LlmSafetyPolicyService } from '../../../../common/llm/llm-safety-policy.service';
import type { LlmRuntimeService } from '../../../../llm-runtime';
import { MealAnalysisVisionService } from '../meal-analysis/vision.service';

describe('MealAnalysisVisionService', () => {
  const createService = (invoke: vi.Mock) => {
    const createChatModel = vi.fn().mockReturnValue({ invoke });
    const safetyPolicyService = new LlmSafetyPolicyService({
      safety: { forbiddenPatterns: [] },
    } as never);
    const service = new MealAnalysisVisionService(
      {
        hasRoleConfig: vi.fn().mockReturnValue(true),
        createChatModel,
      } as unknown as LlmRuntimeService,
      safetyPolicyService,
    );
    return { service, createChatModel, invoke };
  };

  it('invokes the vision role with image input and parses structured JSON', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content:
        '```json\n{"mealDescription":"一份鸡胸肉沙拉","foodItems":[{"name":"鸡胸肉","confidence":0.91,"portionText":"约100克"},{"name":"生菜","confidence":0.83,"portionText":"1份"}]}\n```',
    });
    const { service, createChatModel } = createService(invoke);

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
    const invoke = vi.fn().mockResolvedValue({
      content: '我看起来像是一顿饭，但我没按要求输出 JSON',
    });
    const { service } = createService(invoke);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result).toEqual({
      mealDescription: null,
      foodItems: [],
    });
  });

  it('truncates vision output to safe length limits', async () => {
    const longDescription = '米饭'.repeat(200);
    const longName = '面条'.repeat(100);
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        mealDescription: longDescription,
        foodItems: [
          {
            name: longName,
            confidence: 0.9,
            portionText: '一小碗'.repeat(50),
          },
        ],
      }),
    });
    const { service } = createService(invoke);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result.mealDescription?.length).toBeLessThanOrEqual(200);
    expect(result.foodItems[0]?.name.length).toBeLessThanOrEqual(100);
    expect(result.foodItems[0]?.portionText?.length ?? 0).toBeLessThanOrEqual(
      100,
    );
  });

  it('strips HTML tags and control characters from vision output', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        mealDescription: '<script>alert("xss")</script>一份米饭',
        foodItems: [
          {
            name: '鸡\x00肉',
            confidence: 0.8,
            portionText: '<b>一份</b>',
          },
        ],
      }),
    });
    const { service } = createService(invoke);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result.mealDescription).toBe('一份米饭');
    expect(result.foodItems[0]?.name).toBe('鸡肉');
    expect(result.foodItems[0]?.portionText).toBe('一份');
  });

  it('rejects unsafe food items and meal descriptions based on the safety policy', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        mealDescription: '建议确诊后服用处方药的午餐',
        foodItems: [
          { name: '米饭', confidence: 0.9 },
          { name: '治疗方案配菜', confidence: 0.7 },
        ],
      }),
    });
    const createChatModel = vi.fn().mockReturnValue({ invoke });
    const safetyPolicyService = new LlmSafetyPolicyService({
      safety: { forbiddenPatterns: [] },
    } as never);
    vi.spyOn(safetyPolicyService, 'isSafeText').mockImplementation((text) => {
      const unsafe = /确诊|处方|治疗方案/;
      return !unsafe.test(text);
    });
    const service = new MealAnalysisVisionService(
      {
        hasRoleConfig: vi.fn().mockReturnValue(true),
        createChatModel,
      } as unknown as LlmRuntimeService,
      safetyPolicyService,
    );

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result.mealDescription).toBeNull();
    expect(result.foodItems).toEqual([
      { name: '米饭', confidence: 0.9, portionText: null },
    ]);
  });

  it('returns an empty result when every vision output item is sanitized away', async () => {
    const invoke = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        mealDescription: '<script>',
        foodItems: [{ name: '<b></b>', confidence: 0.9 }],
      }),
    });
    const { service } = createService(invoke);

    const result = await service.recognizeFromImageUrl(
      'https://cos.example.com/meal.jpg',
    );

    expect(result).toEqual({
      mealDescription: null,
      foodItems: [],
    });
  });
});
