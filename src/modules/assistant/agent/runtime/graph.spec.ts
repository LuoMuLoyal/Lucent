import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  buildAssistantRuntimeGraph,
  selectAllowedToolsForContextSources,
} from './graph.js';
import { selectRelevantToolsForMessage } from './router.js';

function streamFromInvoke(invoke: (...args: unknown[]) => unknown) {
  return vi.fn().mockImplementation(async (...args: unknown[]) => {
    const response = (await invoke(...args)) as AIMessage;
    return (async function* () {
      await Promise.resolve();
      yield new AIMessageChunk({
        content: response.content,
        tool_calls: response.tool_calls,
        invalid_tool_calls: response.invalid_tool_calls,
      } as never);
    })();
  });
}

describe('AssistantFoundationGraph', () => {
  it('selects relevant tools from the user message', () => {
    expect(
      selectRelevantToolsForMessage('最近睡眠怎么样', [
        'get_user_profile',
        'get_sleep_summary_by_range',
        'get_current_medicines',
      ]),
    ).toEqual(['get_sleep_summary_by_range']);

    expect(
      selectRelevantToolsForMessage(
        '查一下国药准字H10900089这个药的成分和厂家',
        [
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'search_medicine_leaflets',
        ],
      ),
    ).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);

    expect(
      selectRelevantToolsForMessage(
        '这个国药准字H10900089的禁忌和不良反应是什么',
        [
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'search_medicine_leaflets',
          'resolve_drugbank_entity',
          'get_drugbank_detail',
          'search_drugbank_passages',
          'search_medical_qa_corpus',
        ],
      ),
    ).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);
  });

  it('selects point summary tools for dated history questions', () => {
    expect(
      selectRelevantToolsForMessage('看看 2026-06-17 的 today summary', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_today_summary_by_date']);

    expect(
      selectRelevantToolsForMessage('帮我看上次月报总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_report_summary_by_range']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Today AI 总结', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_recent_today_summaries']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Report AI 总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_recent_report_summaries']);
  });

  it('selects write-intent tools from save-style messages', () => {
    expect(
      selectRelevantToolsForMessage('帮我记一下今天喝了 300ml 水', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['get_today_records', 'propose_create_daily_record']);

    expect(
      selectRelevantToolsForMessage('把今天那条 300ml 饮水记录备注改一下', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_daily_record']);

    expect(
      selectRelevantToolsForMessage('把 assistant memory 关掉', [
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_user_settings']);
  });

  it('derives allowed tools from enabled context sources', () => {
    expect(
      selectAllowedToolsForContextSources(['health_profile', 'sleep_records']),
    ).toEqual([
      'get_today_summary_by_date',
      'get_report_summary_by_range',
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_sleep_summary_by_range',
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
      'search_medical_qa_corpus',
      'resolve_drugbank_entity',
      'get_drugbank_detail',
      'search_drugbank_passages',
      'propose_create_daily_record',
      'propose_update_user_settings',
    ]);
  });

  it('runs the tool-loop graph and returns final content when LLM produces text', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '今天共 3 条饮水记录。' }));
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '帮我查一下今天的记录',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'daily_records'],
    });

    expect(result.intent).toBe('read_data');
    expect(result.relevantTools).toContain('get_today_records');
    expect(result.finalContent).toBe('今天共 3 条饮水记录。');
    expect(result.toolResults).toEqual([]);
    expect(result.stopReason).toBe('answered');
  });

  it('routes simple chat to respond, which produces a tool-free reply', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好，有什么可以帮你？' }));
    const mockModel = {
      bindTools: vi.fn(),
      stream: streamFromInvoke(mockInvoke),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'sleep_records'],
    });

    expect(result.intent).toBe('simple_chat');
    expect(result.relevantTools).toEqual([]);
    expect(result.finalContent).toBe('你好，有什么可以帮你？');
    expect(result.stopReason).toBe('answered');
    // The agent node is skipped: no tools bound, exactly one tool-free call.
    expect(mockModel.bindTools).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('routes write-proposal messages through the write sub-graph', async () => {
    let callCount = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: 'propose_create_daily_record',
                id: 'call_0',
                args: {},
              },
            ],
          }),
        );
      }
      return Promise.resolve(
        new AIMessage({ content: '好的，这是一份待确认的饮水记录草稿。' }),
      );
    });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      stream: streamFromInvoke(vi.fn()),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'propose_create_daily_record',
        data: { draft: {} },
        proposedActions: [
          { id: 'proposal-1', type: 'create_daily_record', status: 'proposed' },
        ],
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '帮我记一下今天喝了 300ml 水',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'daily_records'],
    });

    expect(result.intent).toBe('write_proposal');
    expect(result.relevantTools).toEqual(
      expect.arrayContaining([
        'get_today_records',
        'propose_create_daily_record',
      ]),
    );
    // The LLM only requested the proposal tool; the auxiliary read is bound
    // for context but not executed.
    expect(executeTools).toHaveBeenCalledWith(['propose_create_daily_record']);
    expect(result.finalContent).toBe('好的，这是一份待确认的饮水记录草稿。');
    expect(result.validationFlags.missingProposedActions).toBe(false);
    expect(result.stopReason).toBe('answered');
  });

  it('routes knowledge messages through the knowledge sub-graph', async () => {
    let callCount = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new AIMessage({
            content: '',
            tool_calls: [
              {
                name: 'search_cn_medicine_products',
                id: 'call_0',
                args: { query: '国药准字H10900089' },
              },
            ],
          }),
        );
      }
      return Promise.resolve(
        new AIMessage({ content: '该药品的禁忌与不良反应如下…' }),
      );
    });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      stream: streamFromInvoke(vi.fn()),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'search_cn_medicine_products',
        data: {
          coverage: { status: 'complete' },
          ambiguities: [],
        },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '这个国药准字H10900089的禁忌和不良反应是什么',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'sleep_records'],
    });

    expect(result.intent).toBe('knowledge');
    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(result.finalContent).toBe('该药品的禁忌与不良反应如下…');
    expect(result.validationFlags.hasEmptyResults).toBe(false);
    expect(result.stopReason).toBe('answered');
  });

  it('routes mixed intents through the full agent node', async () => {
    let callCount = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new AIMessage({
            content: '',
            tool_calls: [
              { name: 'get_records_by_range', id: 'call_0', args: {} },
            ],
          }),
        );
      }
      return Promise.resolve(
        new AIMessage({ content: '以下是记录与药品说明书的汇总。' }),
      );
    });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      stream: streamFromInvoke(vi.fn()),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_records_by_range',
        data: { records: [] },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '查一下我最近的记录，顺便查查这个药的说明书',
      locale: 'zh-CN',
      enabledContextSources: [
        'health_profile',
        'sleep_records',
        'daily_records',
      ],
    });

    expect(result.intent).toBe('mixed');
    // The full agent runs (not a sub-graph): tool loop executes normally.
    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(executeTools).toHaveBeenCalledWith(['get_records_by_range']);
    expect(result.finalContent).toBe('以下是记录与药品说明书的汇总。');
    expect(result.stopReason).toBe('answered');
  });

  it('injects cross-conversation memory for new conversations', async () => {
    const buildMemoryBlock = vi
      .fn()
      .mockResolvedValue('Prior memory: user prefers metric units.');
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '明白。' }));
    const mockModel = {
      bindTools: vi.fn(),
      stream: streamFromInvoke(mockInvoke),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      buildMemoryBlock,
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
      memoryEnabled: true,
      isNewConversation: true,
    });

    expect(buildMemoryBlock).toHaveBeenCalledWith('user-1');
    // simple_chat → respond, whose tool-free call receives the memory block.
    const sentMessages =
      (mockInvoke.mock.calls[0]?.[0] as BaseMessage[] | undefined) ?? [];
    expect(
      sentMessages.some(
        (m) =>
          m instanceof HumanMessage &&
          typeof m.content === 'string' &&
          m.content.includes('Prior memory'),
      ),
    ).toBe(true);
    expect(result.finalContent).toBe('明白。');
  });

  it('skips memory injection when memory is disabled or mid-conversation', async () => {
    const buildMemoryBlock = vi.fn().mockResolvedValue('memory');
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '好的。' }));
    const mockModel = {
      bindTools: vi.fn(),
      stream: streamFromInvoke(mockInvoke),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      buildMemoryBlock,
    });

    // memory disabled
    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
      memoryEnabled: false,
      isNewConversation: true,
    });
    // mid-conversation (multiple user messages)
    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
      memoryEnabled: true,
      isNewConversation: false,
    });

    expect(buildMemoryBlock).not.toHaveBeenCalled();
  });

  it('serves repeated simple-chat messages from the response cache', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好呀！' }));
    const mockModel = {
      bindTools: vi.fn(),
      stream: streamFromInvoke(mockInvoke),
    };

    let stored: string | null = null;
    const respondCache = {
      get: vi.fn().mockImplementation(() => Promise.resolve(stored)),
      set: vi.fn().mockImplementation((_key: string, value: string) => {
        stored = value;
        return Promise.resolve();
      }),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      respondCache,
    });

    // First turn: cache miss → one LLM call → reply cached.
    const first = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });
    expect(first.finalContent).toBe('你好呀！');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(respondCache.set).toHaveBeenCalledTimes(1);

    // Second turn (same message): cache hit → no additional LLM call.
    const second = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });
    expect(second.finalContent).toBe('你好呀！');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(respondCache.get).toHaveBeenCalled();
  });

  it('skips the response cache when memory was injected', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '记得的。' }));
    const mockModel = {
      bindTools: vi.fn(),
      stream: streamFromInvoke(mockInvoke),
    };
    const respondCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      buildMemoryBlock: vi.fn().mockResolvedValue('Prior memory…'),
      respondCache,
    });

    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
      memoryEnabled: true,
      isNewConversation: true,
    });

    // Memory-bearing turns must never be cached (user data in context).
    expect(respondCache.get).not.toHaveBeenCalled();
    expect(respondCache.set).not.toHaveBeenCalled();
  });

  it('executes tools when the LLM requests them and loops back', async () => {
    let callCount = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve(
          new AIMessage({
            content: '',
            tool_calls: [{ name: 'get_user_profile', id: 'call_0', args: {} }],
          }),
        );
      }
      return Promise.resolve(new AIMessage({ content: '根据您的健康档案...' }));
    });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_user_profile',
        data: { summary: { activeAllergyCount: 1 } },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '我的过敏情况',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });

    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(executeTools).toHaveBeenCalledWith(['get_user_profile']);
    expect(result.toolResults).toHaveLength(1);
    expect(result.finalContent).toBe('根据您的健康档案...');
    expect(result.loopCount).toBe(1);
    expect(result.stopReason).toBe('answered');
  });

  it('stops at the tool-loop cap when LLM keeps requesting tools', async () => {
    const mockInvoke = vi.fn().mockResolvedValue(
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'get_user_profile', id: 'call_0', args: {} }],
      }),
    );
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      // The respond node makes a final tool-free call after the loop cap.
      stream: streamFromInvoke(
        vi
          .fn()
          .mockResolvedValue(new AIMessage({ content: '查询次数已达上限。' })),
      ),
    };

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_user_profile',
        data: { summary: {} },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '我的情况怎么样',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });

    // MAX_TOOL_LOOPS = 3, so tools are called at most 3 times
    expect(executeTools).toHaveBeenCalledTimes(3);
    expect(result.loopCount).toBe(3);
  });

  it('retries the agent node on transient LLM errors', async () => {
    const mockInvoke = vi
      .fn()
      .mockRejectedValueOnce({ status: 500, message: 'upstream boom' })
      .mockResolvedValueOnce(new AIMessage({ content: '重试成功。' }));
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      stream: streamFromInvoke(
        vi.fn().mockResolvedValue(new AIMessage({ content: '兜底。' })),
      ),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '帮我查一下今天的记录',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile', 'daily_records'],
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.finalContent).toBe('重试成功。');
  });

  it('does not retry non-transient LLM errors', async () => {
    const mockInvoke = vi
      .fn()
      .mockRejectedValue({ status: 400, message: 'bad request' });
    const mockModel = {
      bindTools: vi.fn().mockReturnValue({
        stream: streamFromInvoke(mockInvoke),
      }),
      stream: streamFromInvoke(vi.fn()),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    await expect(
      graph.invoke({
        userId: 'user-1',
        userMessage: '帮我查一下今天的记录',
        locale: 'zh-CN',
        enabledContextSources: ['health_profile', 'daily_records'],
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('skips in-graph review without a checkpointer (old write flow)', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'propose_create_daily_record',
              id: 'call_0',
              args: {},
            },
          ],
        }),
      )
      .mockResolvedValue(
        new AIMessage({ content: '好的，这是一份待确认的饮水记录草稿。' }),
      );
    const mockModel = {
      bindTools: vi.fn().mockReturnThis(),
      stream: streamFromInvoke(mockInvoke),
    };
    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'propose_create_daily_record',
        data: { draft: {} },
        proposedActions: [
          {
            id: 'proposal-1',
            type: 'create_daily_record',
            status: 'proposed',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        ],
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: executeTools as never,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '帮我记录今天喝水 500ml',
      locale: 'zh-CN',
      enabledContextSources: ['health_profile'],
    });

    // No checkpointer → no review nodes: the write flow replies directly.
    expect(result.pendingReview).toBeUndefined();
    expect(result.stopReason).not.toBe('awaiting_review');
    expect(result.finalContent).toBe('好的，这是一份待确认的饮水记录草稿。');
    expect('__interrupt__' in result).toBe(false);
  });
});
