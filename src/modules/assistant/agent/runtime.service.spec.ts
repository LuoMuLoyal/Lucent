import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../../llm-runtime';
import { LlmCircuitBreakerService } from '../../../common/llm/llm-circuit-breaker.service';
import { AssistantRuntimeService } from './runtime.service';
import { buildAssistantSystemPrompt } from '../prompts/system.prompt';

function buildMetricsService() {
  return {
    recordLlmCall: vi.fn(),
    recordLlmTokens: vi.fn(),
    recordCacheAccess: vi.fn(),
    recordBullmqJob: vi.fn(),
    setBullmqActiveJobs: vi.fn(),
    setBullmqWaitingJobs: vi.fn(),
    recordHttpRequest: vi.fn(),
    is_enabled: vi.fn().mockReturnValue(true),
    getMetrics: vi.fn(),
    getContentType: vi.fn(),
  };
}

function buildCacheService() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

function buildCheckpointerService() {
  return { getSaver: () => null };
}

function buildLeafletService(hasChunks = false) {
  return {
    hasIndexedChunks: vi.fn().mockResolvedValue(hasChunks),
    searchMedicineLeaflets: vi.fn(),
  };
}

describe('AssistantRuntimeService', () => {
  it('describes the phase-1 backend foundation', async () => {
    const llmRuntimeService = {
      hasRoleConfig: vi
        .fn()
        .mockImplementation((role: string) => role === 'chat'),
      getModelName: vi.fn().mockReturnValue('test-model'),
    } as unknown as LlmRuntimeService;

    const leafletService = buildLeafletService(false);
    const metricsService = buildMetricsService();
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      leafletService as never,
      metricsService as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );

    expect(service.hasChatModel()).toBe(true);
    expect(await service.describeFoundation()).toEqual({
      phase: 'foundation',
      chatModelConfigured: true,
      interactiveChatReady: true,
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: [
        'prepare_context',
        'classify_intent',
        'agent',
        'tools',
        'read_subgraph',
        'write_subgraph',
        'knowledge_subgraph',
        'respond',
      ],
      toolNames: [
        'get_today_records',
        'get_records_by_date',
        'get_records_by_range',
        'get_today_summary_by_date',
        'get_report_summary_by_range',
        'get_recent_today_summaries',
        'get_recent_report_summaries',
        'get_user_profile',
        'get_user_settings',
        'get_current_medicines',
        'get_sleep_summary_by_range',
        'search_cn_medicine_products',
        'get_cn_medicine_detail',
        'search_medicine_leaflets',
        'search_medical_qa_corpus',
        'resolve_drugbank_entity',
        'get_drugbank_detail',
        'search_drugbank_passages',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_delete_daily_record',
        'propose_update_user_settings',
      ],
      implementedToolNames: [
        'get_today_records',
        'get_records_by_date',
        'get_records_by_range',
        'get_today_summary_by_date',
        'get_report_summary_by_range',
        'get_recent_today_summaries',
        'get_recent_report_summaries',
        'get_user_profile',
        'get_user_settings',
        'get_current_medicines',
        'get_sleep_summary_by_range',
        'search_cn_medicine_products',
        'get_cn_medicine_detail',
        'search_medicine_leaflets',
        'search_medical_qa_corpus',
        'resolve_drugbank_entity',
        'get_drugbank_detail',
        'search_drugbank_passages',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_delete_daily_record',
        'propose_update_user_settings',
      ],
      contextSources: [
        'health_profile',
        'daily_records',
        'sleep_records',
        'current_medicines',
      ],
    });
  });

  it('streams assistant chunks into one final message', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: 'Hello' });
      yield new AIMessageChunk({ content: ' world' });
    }

    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
      getModelName: vi.fn().mockReturnValue('test-model'),
      createChatModel: vi.fn().mockReturnValue({
        stream: vi.fn().mockResolvedValue(buildStream()),
      }),
    } as unknown as LlmRuntimeService;

    const leafletService = buildLeafletService(false);
    const metricsService = buildMetricsService();
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      leafletService as never,
      metricsService as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );
    const onChunk = vi.fn();

    const result = await service.generateStream(
      {
        locale: 'en',
        messages: [{ role: 'user', content: 'Hi' }],
        allowedTools: ['get_user_profile'],
        toolResults: [
          {
            name: 'get_user_profile',
            data: { summary: { activeAllergyCount: 1 } },
          },
        ],
      },
      onChunk,
    );

    expect(result).toEqual({
      content: 'Hello world',
      usedToolNames: ['get_user_profile'],
    });
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'Hello' });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: ' world' });
  });

  it('streams pre-generated content as word-level chunks', async () => {
    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
    } as unknown as LlmRuntimeService;

    const leafletService = buildLeafletService(false);
    const metricsService = buildMetricsService();
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      leafletService as never,
      metricsService as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );
    const onChunk = vi.fn();

    const result = await service.streamPreGeneratedContent(
      'Hello world from assistant',
      [{ name: 'get_user_profile', data: {} }],
      onChunk,
    );

    expect(result.content).toBe('Hello world from assistant');
    expect(result.usedToolNames).toEqual(['get_user_profile']);
    // Chunks should have been called multiple times
    expect(onChunk.mock.calls.length).toBeGreaterThan(1);
  });

  it('documents the tightened read/proposal rules in the system prompt', () => {
    const prompt = buildAssistantSystemPrompt([
      'get_recent_today_summaries',
      'propose_update_daily_record',
    ]);

    expect(prompt).toContain(
      'coverage, timeRange, source, confidence, and ambiguities',
    );
    expect(prompt).toContain(
      'Historical AI summaries mean persisted Today/Report summaries',
    );
    expect(prompt).toContain('Proposal tools do not perform writes');
    expect(prompt).toContain('refusal to guess the write target');
  });

  it('runConversation maps graph output and records success', async () => {
    const mockModel = {
      bindTools: vi.fn(),
      invoke: vi.fn().mockResolvedValue(new AIMessage('你好呀！')),
    };
    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
      getModelName: vi.fn().mockReturnValue('test-model'),
      createChatModel: vi.fn().mockReturnValue(mockModel),
    } as unknown as LlmRuntimeService;

    const cacheService = buildCacheService();
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      cacheService as never,
      buildCheckpointerService() as never,
    );

    const result = await service.runConversation(
      {
        userId: 'u1',
        userMessage: '你好',
        locale: 'zh-CN',
        enabledContextSources: ['health_profile'],
      },
      () => Promise.resolve([]),
    );

    expect(result.finalContent).toBe('你好呀！');
    expect(result.toolResults).toEqual([]);
    expect(mockModel.invoke).toHaveBeenCalledTimes(1);
  });

  it('runConversation records failure and rethrows when the graph fails', async () => {
    const mockModel = {
      bindTools: vi.fn(),
      invoke: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
      getModelName: vi.fn().mockReturnValue('test-model'),
      createChatModel: vi.fn().mockReturnValue(mockModel),
    } as unknown as LlmRuntimeService;

    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );

    await expect(
      service.runConversation(
        {
          userId: 'u1',
          userMessage: '你好',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
        },
        () => Promise.resolve([]),
      ),
    ).rejects.toThrow('LLM down');
  });

  it('generateStream throws when the stream ends with empty content', async () => {
    async function* buildEmptyStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: '   ' });
    }

    const llmRuntimeService = {
      createChatModel: vi.fn().mockReturnValue({
        stream: vi.fn().mockResolvedValue(buildEmptyStream()),
      }),
      getModelName: vi.fn().mockReturnValue('test-model'),
    } as unknown as LlmRuntimeService;

    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );

    await expect(
      service.generateStream(
        {
          locale: 'zh-CN',
          messages: [{ role: 'user', content: 'hi' }],
          allowedTools: [],
          toolResults: [],
        },
        vi.fn(),
      ),
    ).rejects.toThrow('stream ended without any assistant content');
  });

  it('generateStream flattens array chunk content', async () => {
    async function* buildArrayStream() {
      await Promise.resolve();
      yield new AIMessageChunk({
        content: [
          { type: 'text', text: 'A' },
          { type: 'text', text: 'B' },
          { type: 'image_url', image_url: 'x' },
        ],
      });
    }

    const llmRuntimeService = {
      createChatModel: vi.fn().mockReturnValue({
        stream: vi.fn().mockResolvedValue(buildArrayStream()),
      }),
      getModelName: vi.fn().mockReturnValue('test-model'),
    } as unknown as LlmRuntimeService;

    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );
    const onChunk = vi.fn();

    const result = await service.generateStream(
      {
        locale: 'zh-CN',
        messages: [{ role: 'user', content: 'hi' }],
        allowedTools: [],
        toolResults: [],
      },
      onChunk,
    );

    expect(result.content).toBe('AB');
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'AB' });
  });

  it('describeFoundation reports chat model unavailable', async () => {
    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(false),
    } as unknown as LlmRuntimeService;

    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      buildCheckpointerService() as never,
    );

    const foundation = await service.describeFoundation();
    expect(foundation.chatModelConfigured).toBe(false);
    expect(foundation.interactiveChatReady).toBe(false);
    expect(foundation.ragEnabled).toBe(false);
  });
});
