import { AssistantIntentClassifierService } from './intent-classifier.js';
import { ROUTER_HISTORY_MESSAGE_MAX_CHARS } from './intent-router-prompt.js';
import { LlmCircuitBreakerService } from '../../../../common/llm/safety/llm-circuit-breaker.service.js';
import type { LlmRuntimePort } from '../../../../common/llm/llm-runtime.port.js';
import type { MetricsService } from '../../../../common/metrics/metrics.service.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';

const CANDIDATES: ToolName[] = [
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
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
      [],
    );

    expect(outcome).toEqual({ source: 'llm', tools: [] });
    expect(mocks.mockModel.invoke).not.toHaveBeenCalled();
  });

  describe('conversation history', () => {
    /**
     * The defect this suite exists for: 「布洛芬有什么副作用」 then 「那你查一下」.
     *
     * Routed on the final message alone, the four-character follow-up carries no
     * antecedent, so the model returns `[]`, `deriveIntent([])` collapses the
     * turn into `simple_chat`, and the answer binds no tool at all. The router
     * prompt must therefore carry the prior turns.
     */
    it('renders prior turns into the routing prompt', async () => {
      const mocks = createMocks();
      mocks.mockModel.invoke.mockResolvedValue({
        tools: ['search_cn_medicine_knowledge'],
      });

      await buildService(mocks).selectTools(
        '那你查一下',
        'zh-CN',
        [],
        CANDIDATES,
        [
          { role: 'user', content: '布洛芬有什么副作用' },
          { role: 'assistant', content: '布洛芬的常见不良反应包括…' },
        ],
      );

      const prompt = readRoutingUserPrompt(mocks);
      expect(prompt).toContain('布洛芬有什么副作用');
      expect(prompt).toContain('User: 布洛芬有什么副作用');
      expect(prompt).toContain('Assistant: 布洛芬的常见不良反应包括…');
      // 历史必须排在候选工具目录**之后**、本轮消息**之前**：工具目录是硬约束，
      // 本轮消息要最后读。
      expect(prompt.indexOf('Candidate tools for this turn')).toBeLessThan(
        prompt.indexOf('Earlier turns of this conversation'),
      );
      expect(prompt.indexOf('Earlier turns of this conversation')).toBeLessThan(
        prompt.indexOf('User message (language:'),
      );
    });

    it('omits the history block when there is no prior turn', async () => {
      const mocks = createMocks();
      mocks.mockModel.invoke.mockResolvedValue({ tools: [] });

      await buildService(mocks).selectTools(
        '你好',
        'zh-CN',
        [],
        CANDIDATES,
        [],
      );

      const prompt = readRoutingUserPrompt(mocks);
      // 空历史不渲染标题：一个空区块会让模型以为"有前文但读不到"。
      expect(prompt).not.toContain('Earlier turns of this conversation');
    });

    it('clips an over-long prior turn instead of replaying it whole', async () => {
      const mocks = createMocks();
      mocks.mockModel.invoke.mockResolvedValue({ tools: [] });

      const longAnswer = 'x'.repeat(ROUTER_HISTORY_MESSAGE_MAX_CHARS + 500);
      await buildService(mocks).selectTools(
        '那你查一下',
        'zh-CN',
        [],
        CANDIDATES,
        [
          { role: 'user', content: '布洛芬有什么副作用' },
          { role: 'assistant', content: longAnswer },
        ],
      );

      const prompt = readRoutingUserPrompt(mocks);
      // 截断 + 省略号：路由只需要知道"上轮覆盖了什么领域"，完整正文由答题模型读。
      expect(prompt).toContain(
        `${'x'.repeat(ROUTER_HISTORY_MESSAGE_MAX_CHARS)}…`,
      );
      expect(prompt).not.toContain('x'.repeat(longAnswer.length));
    });
  });
});

/**
 * Reads the user prompt the classifier actually sent to the model.
 *
 * The classifier delegates prompt assembly to `buildUserPrompt`, so asserting on
 * what the model received is the only way to prove the history reached it —
 * asserting on the classifier's own inputs would pass even if the prompt
 * builder dropped them.
 */
function readRoutingUserPrompt(mocks: ReturnType<typeof createMocks>): string {
  const call = mocks.mockModel.invoke.mock.calls.at(-1);
  const messages = call?.[0] as Array<{ content: unknown }> | undefined;
  const userMessage = messages?.at(-1);
  const content = userMessage?.content;
  if (typeof content !== 'string') {
    throw new Error('Mock model did not receive a plain-text user prompt.');
  }
  return content;
}
