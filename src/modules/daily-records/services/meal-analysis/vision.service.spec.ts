import { Logger } from '@nestjs/common';
import type { LlmSafetyPolicyService } from '../../../../common/llm/safety/llm-safety-policy.service.js';
import type { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { MEAL_ANALYSIS_VISION_TIMEOUT_MS } from '../../constants/meal-analysis.constants.js';
import { MealAnalysisVisionService } from './vision.service.js';

const modelOutput = {
  calorieRange: { min: 520, max: 780 },
  dishes: ['红烧肉', '青菜'],
  items: [
    {
      rank: 1,
      kind: 'fried',
      polarity: 'watch',
      headline: '油炸偏多',
      detail: '午饭油炸食品摄入偏多，建议晚饭多摄入蔬菜',
    },
  ],
  facets: [{ kind: 'fried', level: 'high' }],
};

function buildService(options?: {
  invoke?: ReturnType<typeof vi.fn>;
  modelName?: string | null;
  safe?: boolean;
  configured?: boolean;
}) {
  const invoke = options?.invoke ?? vi.fn().mockResolvedValue(modelOutput);
  const withStructuredOutput = vi.fn().mockReturnValue({ invoke });
  const createChatModel = vi.fn().mockReturnValue({ withStructuredOutput });
  const isSafeText = vi.fn().mockReturnValue(options?.safe ?? true);

  const llmRuntimeService = {
    hasRoleConfig: vi.fn().mockReturnValue(options?.configured ?? true),
    createChatModel,
    getModelName: vi.fn().mockReturnValue(options?.modelName ?? 'vision-model'),
  } as unknown as LlmRuntimeService;
  const safetyPolicyService = {
    isSafeText,
  } as unknown as LlmSafetyPolicyService;

  return {
    service: new MealAnalysisVisionService(
      llmRuntimeService,
      safetyPolicyService,
    ),
    invoke,
    withStructuredOutput,
    createChatModel,
    isSafeText,
  };
}

describe('MealAnalysisVisionService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('reports configuration from the vision role', () => {
    expect(buildService({ configured: true }).service.isConfigured()).toBe(
      true,
    );
    expect(buildService({ configured: false }).service.isConfigured()).toBe(
      false,
    );
  });

  it('runs one structured multimodal call with a timeout', async () => {
    const { service, createChatModel, withStructuredOutput, invoke } =
      buildService();

    await service.analyze({
      imageUrl: 'https://cdn.example.com/m.jpg',
      locale: 'zh-CN',
    });

    expect(createChatModel).toHaveBeenCalledWith('vision', {
      temperature: 0.1,
      maxRetries: 0,
      timeout: MEAL_ANALYSIS_VISION_TIMEOUT_MS,
    });
    expect(withStructuredOutput).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'functionCalling', strict: true }),
    );

    const messages = invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>;
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[0]?.content)).toContain('中文');
    expect(JSON.stringify(messages[1]?.content)).toContain(
      'https://cdn.example.com/m.jpg',
    );
  });

  it('returns the draft with the machine facets converted to a record', async () => {
    const { service } = buildService();

    const outcome = await service.analyze({
      imageUrl: 'https://cdn.example.com/m.jpg',
      locale: 'zh-CN',
    });

    expect(outcome).toEqual({
      ok: true,
      model: 'vision-model',
      draft: {
        calorieRange: { min: 520, max: 780 },
        dishes: [
          { name: '红烧肉', source: 'model' },
          { name: '青菜', source: 'model' },
        ],
        items: [
          {
            rank: 1,
            kind: 'fried',
            polarity: 'watch',
            headline: '油炸偏多',
            detail: '午饭油炸食品摄入偏多，建议晚饭多摄入蔬菜',
          },
        ],
        facets: { fried: 'high' },
      },
    });
  });

  it('fails with invalid_output when the model output violates the contract', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...modelOutput,
      items: [{ rank: 1, kind: 'greasy', headline: 'x', detail: 'y' }],
    });
    const { service } = buildService({ invoke });

    await expect(
      service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('fails with invalid_output when nothing usable survives', async () => {
    const invoke = vi.fn().mockResolvedValue({
      calorieRange: null,
      dishes: [],
      items: [],
      facets: [],
    });
    const { service } = buildService({ invoke });

    await expect(
      service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_output' });
  });

  it('fails when nothing usable survives the safety filter', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ...modelOutput,
      calorieRange: null,
      facets: [],
    });
    const { service, isSafeText } = buildService({ invoke, safe: false });

    await expect(
      service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_output' });
    expect(isSafeText).toHaveBeenCalled();
  });

  it('keeps the calorie interval when only the text is unsafe', async () => {
    const { service } = buildService({ safe: false });

    await expect(
      service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({
      ok: true,
      model: 'vision-model',
      draft: {
        calorieRange: { min: 520, max: 780 },
        dishes: [],
        items: [],
        facets: { fried: 'high' },
      },
    });
  });

  it('classifies timeouts separately from other model failures', async () => {
    const timeout = new Error('Request timed out.');
    timeout.name = 'TimeoutError';
    const timedOut = buildService({
      invoke: vi.fn().mockRejectedValue(timeout),
    });
    await expect(
      timedOut.service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({ ok: false, reason: 'model_timeout' });

    const broken = buildService({
      invoke: vi.fn().mockRejectedValue(new Error('upstream 500')),
    });
    await expect(
      broken.service.analyze({
        imageUrl: 'https://cdn.example.com/m.jpg',
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({ ok: false, reason: 'model_failed' });
  });
});
