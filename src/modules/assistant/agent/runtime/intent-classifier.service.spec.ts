import { AssistantIntentClassifierService } from './intent-classifier.service.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import type { LlmRuntimePort } from '../../../../common/llm/llm-runtime.port.js';
import type { MetricsService } from '../../../../common/metrics/metrics.service.js';
import type { AssistantToolName } from '../../tools/shared/tool-types.js';

const CANDIDATES: AssistantToolName[] = [
  'get_today_records',
  'get_user_profile',
  'search_cn_medicine_knowledge',
  'reason_over_ontology',
  'propose_create_daily_record',
];

function createMocks() {
  const mockModel = {
    invoke: vi.fn(),
    stream: vi.fn(),
    withStructuredOutput: vi.fn().mockReturnThis(),
    withConfig: vi.fn().mockReturnThis(),
  };

  const llmRuntimeService: vi.Mocked<LlmRuntimePort> = {
    hasRoleConfig: vi.fn().mockReturnValue(true),
    createChatModel: vi.fn().mockReturnValue(mockModel),
    getModelName: vi.fn().mockReturnValue('test-model'),
  };

  const metrics = {
    recordLlmCall: vi.fn(),
    recordAssistantIntentRouting: vi.fn(),
  } as unknown as MetricsService;

  return {
    mockModel,
    llmRuntimeService,
    metrics,
    circuitBreaker: new LlmCircuitBreakerService(),
  };
}

function buildService(mocks: ReturnType<typeof createMocks>) {
  return new AssistantIntentClassifierService(
    mocks.llmRuntimeService as never,
    mocks.metrics,
    mocks.circuitBreaker,
  );
}

describe('AssistantIntentClassifierService', () => {
  it('returns the model selection, intersected with the candidate set', async () => {
    const mocks = createMocks();
    // `search_cn_medicine_products` 不在候选集里（例如用户没开对应来源、或 sidecar 不可用，
    // 又或者是模型幻觉/提示注入）—— 必须被丢掉，只留交集。
    mocks.mockModel.invoke.mockResolvedValue({
      tools: ['search_cn_medicine_knowledge', 'search_cn_medicine_products'],
    });

    const outcome = await buildService(mocks).selectTools(
      '阿司匹林的禁忌',
      'zh-CN',
      [],
      CANDIDATES,
    );

    expect(outcome).toEqual({
      source: 'llm',
      tools: ['search_cn_medicine_knowledge'],
    });
    expect(mocks.metrics.recordAssistantIntentRouting).toHaveBeenCalledWith(
      'llm',
    );
  });

  it('keeps an empty selection as an empty list (simple chat)', async () => {
    const mocks = createMocks();
    mocks.mockModel.invoke.mockResolvedValue({ tools: [] });

    const outcome = await buildService(mocks).selectTools(
      '你好',
      'zh-CN',
      ['health_profile'],
      CANDIDATES,
    );

    expect(outcome).toEqual({ source: 'llm', tools: [] });
  });

  it('degrades to all candidate tools when the routing role is not configured', async () => {
    const mocks = createMocks();
    mocks.llmRuntimeService.hasRoleConfig.mockReturnValue(false);

    const outcome = await buildService(mocks).selectTools(
      '阿司匹林的禁忌',
      'zh-CN',
      [],
      CANDIDATES,
    );

    expect(outcome.source).toBe('degraded_all_tools');
    expect(mocks.mockModel.invoke).not.toHaveBeenCalled();
    expect(mocks.metrics.recordAssistantIntentRouting).toHaveBeenCalledWith(
      'degraded_all_tools',
    );
  });

  it('degrades instead of throwing when the model call fails', async () => {
    const mocks = createMocks();
    mocks.mockModel.invoke.mockRejectedValue(new Error('upstream boom'));

    const outcome = await buildService(mocks).selectTools(
      '阿司匹林的禁忌',
      'zh-CN',
      [],
      CANDIDATES,
    );

    expect(outcome.source).toBe('degraded_all_tools');
    expect(mocks.metrics.recordAssistantIntentRouting).toHaveBeenCalledWith(
      'degraded_all_tools',
    );
  });

  it('degrades instead of throwing when the structured output is malformed', async () => {
    const mocks = createMocks();
    mocks.mockModel.invoke.mockResolvedValue({ tools: 'not-an-array' });

    const outcome = await buildService(mocks).selectTools(
      '阿司匹林的禁忌',
      'zh-CN',
      [],
      CANDIDATES,
    );

    expect(outcome.source).toBe('degraded_all_tools');
  });

  it('skips the model entirely when there is no candidate tool', async () => {
    const mocks = createMocks();

    const outcome = await buildService(mocks).selectTools(
      '你好',
      'zh-CN',
      [],
      [],
    );

    expect(outcome).toEqual({ source: 'llm', tools: [] });
    expect(mocks.mockModel.invoke).not.toHaveBeenCalled();
  });
});
