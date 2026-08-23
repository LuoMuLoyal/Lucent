import { AIMessageChunk } from '@langchain/core/messages';
import { InternalServerErrorException } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph';
import type { LlmRuntimeService } from '../../../llm-runtime';
import { LlmCircuitBreakerService } from '../../../common/llm/llm-circuit-breaker.service';
import { okAsync } from '../../../common/result';
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

function buildConversationRepository() {
  return {
    findLatestActiveWithMessages: vi.fn(),
    listRecentSummaries: vi.fn(),
    findWithMessages: vi.fn(),
    findWithMessagesById: vi.fn(),
    create: vi.fn(),
    archiveConversation: vi.fn(),
    softDelete: vi.fn(),
    updateTitle: vi.fn(),
    activateConversation: vi.fn(),
    persistTurn: vi.fn(),
    appendAssistantMessage: vi.fn(),
    findRecentRegeneration: vi.fn(),
    createRegeneration: vi.fn(),
  };
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
      buildConversationRepository() as never,
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
      buildConversationRepository() as never,
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
      buildConversationRepository() as never,
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
    const stream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: '你好呀！' });
      })(),
    );
    const mockModel = {
      bindTools: vi.fn(),
      invoke: vi.fn(),
      stream,
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
      buildConversationRepository() as never,
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
    expect(result.streamedContent).toBe(true);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(mockModel.invoke).not.toHaveBeenCalled();
  });

  it('forwards graph-generated text before runConversation resolves', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: '你好' });
      await Promise.resolve();
      yield new AIMessageChunk({ content: '呀！' });
    }

    const invoke = vi.fn();
    const stream = vi.fn().mockResolvedValue(buildStream());
    const mockModel = {
      bindTools: vi.fn(),
      invoke,
      stream,
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
      buildConversationRepository() as never,
    );
    const chunks: string[] = [];
    let conversationResolved = false;

    const result = await Reflect.apply(service.runConversation, service, [
      {
        userId: 'u1',
        userMessage: '你好',
        locale: 'zh-CN',
        enabledContextSources: ['health_profile'],
      },
      () => Promise.resolve([]),
      ({ content }: { content: string }) => {
        expect(conversationResolved).toBe(false);
        chunks.push(content);
      },
    ]);
    conversationResolved = true;

    expect(chunks).toEqual(['你好', '呀！']);
    expect(result.finalContent).toBe('你好呀！');
    expect(result.streamedContent).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('runConversation records failure and rethrows when the graph fails', async () => {
    const mockModel = {
      bindTools: vi.fn(),
      invoke: vi.fn(),
      stream: vi.fn().mockRejectedValue(new Error('LLM down')),
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
      buildConversationRepository() as never,
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
      buildConversationRepository() as never,
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
      buildConversationRepository() as never,
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
      buildConversationRepository() as never,
    );

    const foundation = await service.describeFoundation();
    expect(foundation.chatModelConfigured).toBe(false);
    expect(foundation.interactiveChatReady).toBe(false);
    expect(foundation.ragEnabled).toBe(false);
  });

  /** Builds a service whose checkpointer is a fresh MemorySaver and whose model produces one proposal then a reply. */
  function buildResumeService(expiresAt: string) {
    const responses = [
      new AIMessageChunk({
        content: '',
        tool_calls: [
          {
            name: 'propose_create_daily_record',
            id: 'call_0',
            args: {},
          },
        ],
      }),
      new AIMessageChunk({
        content: '已确认，请在记录页完成保存。',
      }),
    ];
    const mockModel = {
      bindTools: vi.fn().mockReturnThis(),
      invoke: vi.fn(),
      stream: vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        const response = responses.shift();
        return (async function* () {
          await Promise.resolve();
          if (response != null) {
            yield response;
          }
        })();
      }),
    };
    const llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
      getModelName: vi.fn().mockReturnValue('test-model'),
      createChatModel: vi.fn().mockReturnValue(mockModel),
    } as unknown as LlmRuntimeService;
    const saver = new MemorySaver();
    const service = new AssistantRuntimeService(
      llmRuntimeService,
      buildLeafletService() as never,
      buildMetricsService() as never,
      new LlmCircuitBreakerService(),
      buildCacheService() as never,
      { getSaver: () => saver } as never,
      buildConversationRepository() as never,
    );
    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'propose_create_daily_record',
        data: { draft: {} },
        proposedActions: [
          {
            id: 'proposal-1',
            type: 'create_daily_record',
            status: 'proposed',
            expiresAt,
          },
        ],
      },
    ]);
    const conversationInput = {
      userId: 'u1',
      userMessage: '帮我记录今天喝水 500ml',
      locale: 'zh-CN' as const,
      enabledContextSources: ['health_profile' as const],
      conversationId: 'conv-1',
    };
    return { service, executeTools, conversationInput };
  }

  describe('readPendingProposals', () => {
    it('reads the pending review and proposals from a suspended thread', async () => {
      const { service, executeTools, conversationInput } = buildResumeService(
        '2099-01-01T00:00:00.000Z',
      );

      await service.runConversation(conversationInput, executeTools as never);

      const read = await service.readPendingProposals('conv-1');
      expect(read.pendingReview).toMatchObject({
        proposalIds: ['proposal-1'],
        status: 'pending',
      });
      expect(read.proposals).toHaveLength(1);
      expect(read.proposals[0]).toMatchObject({
        id: 'proposal-1',
        type: 'create_daily_record',
      });
    });

    it('returns null review and empty proposals for a thread without proposals', async () => {
      const llmRuntimeService = {
        hasRoleConfig: vi.fn().mockReturnValue(true),
        getModelName: vi.fn().mockReturnValue('test-model'),
        createChatModel: vi.fn().mockReturnValue({
          bindTools: vi.fn().mockReturnThis(),
          invoke: vi.fn(),
          stream: vi.fn().mockResolvedValue(
            (async function* () {
              await Promise.resolve();
              yield new AIMessageChunk({ content: '你好！' });
            })(),
          ),
        }),
      } as unknown as LlmRuntimeService;
      const saver = new MemorySaver();
      const service = new AssistantRuntimeService(
        llmRuntimeService,
        buildLeafletService() as never,
        buildMetricsService() as never,
        new LlmCircuitBreakerService(),
        buildCacheService() as never,
        { getSaver: () => saver } as never,
        buildConversationRepository() as never,
      );

      // A plain chat turn never suspends; the state has no pending review.
      await service.runConversation(
        {
          userId: 'u1',
          userMessage: '你好',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: 'conv-1',
        },
        (() => Promise.resolve([])) as never,
      );

      const read = await service.readPendingProposals('conv-1');
      expect(read.pendingReview).toBeNull();
      expect(read.proposals).toEqual([]);
    });
  });

  describe('resumeConversation', () => {
    it('resumes a pending review after approval', async () => {
      const { service, executeTools, conversationInput } = buildResumeService(
        '2099-01-01T00:00:00.000Z',
      );

      // First turn: the write flow suspends with a pending review.
      await service.runConversation(conversationInput, executeTools as never);

      const resumed = await service
        .resumeConversation({
          userId: 'u1',
          conversationId: 'conv-1',
          decision: 'approved',
          note: 'ok',
        })
        .unwrapOr(null);
      expect(resumed!.finalContent).toBe('已确认，请在记录页完成保存。');
    });

    it('rejects an already-decided review', async () => {
      const { service, executeTools, conversationInput } = buildResumeService(
        '2099-01-01T00:00:00.000Z',
      );

      await service.runConversation(conversationInput, executeTools as never);
      await service
        .resumeConversation({
          userId: 'u1',
          conversationId: 'conv-1',
          decision: 'approved',
        })
        .unwrapOr(null);

      const second = await service.resumeConversation({
        userId: 'u1',
        conversationId: 'conv-1',
        decision: 'rejected',
      });

      expect(second.isErr()).toBe(true);
      if (second.isErr()) {
        expect(second.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('regenerateLastMessage', () => {
    const ASSISTANT_CONTENT = '你的睡眠情况总结';
    const CONVERSATION_ID = 'conv-reg';
    const USER_ID = 'u-reg';

    /** Builds a service whose graph runs over a MemorySaver thread and whose model answers with plain text (read flow). */
    function buildRegenerateHarness(replayContent = '重新生成的睡眠总结') {
      const responses = [
        new AIMessageChunk({ content: ASSISTANT_CONTENT }),
        // second answer consumed by replayFromCheckpoint's respond re-run
        new AIMessageChunk({ content: replayContent }),
      ];
      const mockModel = {
        bindTools: vi.fn().mockReturnThis(),
        invoke: vi.fn(),
        stream: vi.fn().mockImplementation(async () => {
          await Promise.resolve();
          const response = responses.shift();
          return (async function* () {
            await Promise.resolve();
            if (response != null) {
              yield response;
            }
          })();
        }),
      };
      const llmRuntimeService = {
        hasRoleConfig: vi.fn().mockReturnValue(true),
        getModelName: vi.fn().mockReturnValue('test-model'),
        createChatModel: vi.fn().mockReturnValue(mockModel),
      } as unknown as LlmRuntimeService;
      const saver = new MemorySaver();
      const repository = {
        findWithMessages: vi.fn(),
        findRecentRegeneration: vi.fn().mockResolvedValue(null),
        createRegeneration: vi.fn().mockReturnValue(okAsync({ id: 'reg-1' })),
      };
      const service = new AssistantRuntimeService(
        llmRuntimeService,
        buildLeafletService() as never,
        buildMetricsService() as never,
        new LlmCircuitBreakerService(),
        buildCacheService() as never,
        { getSaver: () => saver } as never,
        repository as never,
      );
      return { service, repository, mockModel };
    }

    function buildConversationWithMessages(
      lastAssistantContent: string,
    ): unknown {
      const now = new Date();
      return {
        id: CONVERSATION_ID,
        userId: USER_ID,
        title: null,
        status: 'active' as never,
        messages: [
          {
            id: 'msg-user-1',
            conversationId: CONVERSATION_ID,
            userId: USER_ID,
            role: 'user',
            content: '最近睡眠怎么样',
            usedTools: [],
            createdAt: new Date(now.getTime() - 60000),
            updatedAt: new Date(now.getTime() - 60000),
          },
          {
            id: 'msg-assistant-last',
            conversationId: CONVERSATION_ID,
            userId: USER_ID,
            role: 'assistant',
            content: lastAssistantContent,
            usedTools: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      };
    }

    it('locates the respond checkpoint and records the mapping', async () => {
      const { service, repository } = buildRegenerateHarness();
      // Run one real conversation so the thread has checkpoint history.
      await service.runConversation(
        {
          userId: USER_ID,
          userMessage: '最近睡眠怎么样',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: CONVERSATION_ID,
        },
        (() => Promise.resolve([])) as never,
      );
      repository.findWithMessages.mockResolvedValue(
        buildConversationWithMessages(ASSISTANT_CONTENT),
      );

      const result = (
        await service.regenerateLastMessage(USER_ID, CONVERSATION_ID)
      ).unwrapOr(null);

      expect(result!.sourceMessageId).toBe('msg-assistant-last');
      expect(result!.checkpointId).toEqual(expect.any(String));
      expect(repository.createRegeneration).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        sourceMessageId: 'msg-assistant-last',
        checkpointId: result!.checkpointId,
      });
    });

    it('rejects when the last persisted message is not assistant', async () => {
      const { service, repository } = buildRegenerateHarness();
      await service.runConversation(
        {
          userId: USER_ID,
          userMessage: '最近睡眠怎么样',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: CONVERSATION_ID,
        },
        (() => Promise.resolve([])) as never,
      );
      const conversation = buildConversationWithMessages(ASSISTANT_CONTENT) as {
        messages: Array<{ id: string; role: string; content: string }>;
      };
      conversation.messages = conversation.messages.filter(
        (message) => message.role !== 'assistant',
      );
      repository.findWithMessages.mockResolvedValue(conversation);

      const result = await service.regenerateLastMessage(
        USER_ID,
        CONVERSATION_ID,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects when the checkpoint text does not match the persisted message', async () => {
      const { service, repository } = buildRegenerateHarness();
      await service.runConversation(
        {
          userId: USER_ID,
          userMessage: '最近睡眠怎么样',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: CONVERSATION_ID,
        },
        (() => Promise.resolve([])) as never,
      );
      // The DB says the last answer was something else entirely.
      repository.findWithMessages.mockResolvedValue(
        buildConversationWithMessages('完全不同的旧答案'),
      );

      const result = await service.regenerateLastMessage(
        USER_ID,
        CONVERSATION_ID,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects duplicate regenerations within the idempotency window', async () => {
      const { service, repository } = buildRegenerateHarness();
      await service.runConversation(
        {
          userId: USER_ID,
          userMessage: '最近睡眠怎么样',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: CONVERSATION_ID,
        },
        (() => Promise.resolve([])) as never,
      );
      repository.findWithMessages.mockResolvedValue(
        buildConversationWithMessages(ASSISTANT_CONTENT),
      );
      repository.findRecentRegeneration.mockResolvedValue({
        id: 'reg-existing',
        createdAt: new Date(),
      });

      const duplicate = await service.regenerateLastMessage(
        USER_ID,
        CONVERSATION_ID,
      );

      expect(duplicate.isErr()).toBe(true);
      if (duplicate.isErr()) {
        expect(duplicate.error.code).toBe('RESOURCE_CONFLICT');
      }
    });

    it('replays the respond node and appends the new answer to the thread', async () => {
      const { service, repository, mockModel } = buildRegenerateHarness();
      await service.runConversation(
        {
          userId: USER_ID,
          userMessage: '最近睡眠怎么样',
          locale: 'zh-CN',
          enabledContextSources: ['health_profile'],
          conversationId: CONVERSATION_ID,
        },
        (() => Promise.resolve([])) as never,
      );
      repository.findWithMessages.mockResolvedValue(
        buildConversationWithMessages(ASSISTANT_CONTENT),
      );

      const { checkpointId } = (
        await service.regenerateLastMessage(USER_ID, CONVERSATION_ID)
      ).unwrapOr(null) as { checkpointId: string; sourceMessageId: string };

      const streamed: string[] = [];
      const { finalContent } = await service.replayFromCheckpoint(
        CONVERSATION_ID,
        checkpointId,
        (text) => {
          streamed.push(text);
        },
      );

      expect(
        (mockModel.stream as ReturnType<typeof vi.fn>).mock.calls,
      ).toHaveLength(2);
      expect(finalContent).toBe('重新生成的睡眠总结');
      expect(streamed).toContain('重新生成的睡眠总结');
    });

    it('returns a safe internal error and logs when replay produces no content', async () => {
      const { service } = buildRegenerateHarness();
      const graph = {
        updateState: vi.fn(),
        invoke: vi.fn().mockResolvedValue({ finalContent: '   ' }),
      };
      const serviceWithGraph = service as unknown as {
        buildGraphWithCheckpointer: (...args: unknown[]) => typeof graph;
      };
      vi.spyOn(serviceWithGraph, 'buildGraphWithCheckpointer').mockReturnValue(
        graph,
      );
      const logger = (
        service as unknown as {
          logger: { error: (...args: unknown[]) => void };
        }
      ).logger;
      const errorSpy = vi.spyOn(logger, 'error');

      await expect(
        service.replayFromCheckpoint(CONVERSATION_ID, 'checkpoint-1', vi.fn()),
      ).rejects.toMatchObject({
        response: {
          code: 'ASSISTANT_REGENERATION_NO_CONTENT',
          message: 'Assistant regeneration could not produce a response.',
        },
      });
      expect(errorSpy).toHaveBeenCalled();
      await expect(
        service.replayFromCheckpoint(CONVERSATION_ID, 'checkpoint-1', vi.fn()),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
