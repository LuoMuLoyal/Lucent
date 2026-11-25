import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { buildAssistantRuntimeGraph, selectPermittedTools } from './graph.js';
import { TOOL_NAMES } from '../../domain/policies/tool-permission.js';
import type { ToolName } from '../../domain/policies/tool-permission.js';
import type { AssistantToolExecutionResult } from '../../application/ports/assistant.js';

/**
 * One ReAct loop: `prepare_context → agent ⇄ tools → validate → respond`.
 *
 * There is no router to stub. These tests therefore drive the graph the way
 * production does — by making the model return tool calls — and assert what the
 * loop does with them: bind the whole candidate set, execute, feed results back,
 * stop at the cap, and let `validate` decide the stop reason.
 *
 * What used to be asserted here and is deliberately gone: which sub-graph a
 * message routed into, and which intent a tool set projected to. Both described
 * a layer that no longer exists.
 */

/** Turns a resolved AIMessage into the async chunk stream the node consumes. */
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

/** Builds a fake model whose stream is driven by the given invoker. */
function buildModel(invoke: (...args: unknown[]) => unknown) {
  return {
    bindTools: vi.fn().mockReturnValue({
      stream: streamFromInvoke(invoke),
    }),
    stream: streamFromInvoke(invoke),
  };
}

/** A tool call the model asks for, in the shape the provider returns. */
function toolCall(name: ToolName, args: Record<string, unknown> = {}) {
  return { id: `call_${name}`, name, args };
}

/** An envelope-shaped empty result (what a read tool returns when it finds nothing). */
function emptyEnvelope(name: ToolName): AssistantToolExecutionResult {
  return {
    name,
    data: {
      coverage: { status: 'empty' },
      result: { verifiability: 'citable' },
    },
  } as AssistantToolExecutionResult;
}

describe('AssistantRuntimeGraph', () => {
  it('binds every candidate tool — no router narrows the set', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '好的。' }));
    const mockModel = buildModel(mockInvoke);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const candidates: ToolName[] = [
      'get_today_records',
      'search_cn_knowledge',
      'create_record_draft',
    ];
    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      allowedTools: candidates,
      enabledContextSources: ['daily_records'],
    });

    expect(mockModel.bindTools).toHaveBeenCalledTimes(1);
    const bound = mockModel.bindTools.mock.calls[0]?.[0] as Array<{
      function: { name: string };
    }>;
    expect(bound.map((definition) => definition.function.name)).toEqual(
      candidates,
    );
  });

  it('binds nothing and answers directly when the candidate set is empty', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好，有什么可以帮你？' }));
    const mockModel = buildModel(mockInvoke);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      allowedTools: [],
      enabledContextSources: [],
    });

    // No candidate tools → `agent` short-circuits to `no_match` without binding
    // anything; `respond` then writes the reply from the plain prompt.
    expect(mockModel.bindTools).not.toHaveBeenCalled();
    expect(result.selectedTools).toEqual([]);
    expect(result.finalContent).toBe('你好，有什么可以帮你？');
  });

  it('derives allowed tools from enabled context sources', () => {
    expect(selectPermittedTools(['health_profile', 'sleep_records'])).toEqual([
      'get_today_summary',
      'get_report_summary',
      'get_today_summaries',
      'get_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_sleep_summary',
      'search_cn_products',
      'get_cn_product_detail',
      'search_cn_knowledge',
      'resolve_drugbank',
      'get_drugbank_detail',
      'search_drugbank',
      'search_adverse_reactions',
      'reason_ontology',
      'reason_rules',
      'create_record_draft',
      'update_settings_draft',
    ]);
  });

  it('answers without tools when the model returns plain text', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '今天共 3 条饮水记录。' }));
    const mockModel = buildModel(mockInvoke);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '帮我查一下今天的记录',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['health_profile', 'daily_records'],
    });

    expect(result.finalContent).toBe('今天共 3 条饮水记录。');
    expect(result.toolResults).toEqual([]);
    expect(result.stopReason).toBe('answered');
  });

  it('executes tools the model asks for and feeds the results back', async () => {
    let call = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      call += 1;
      return call === 1
        ? new AIMessage({
            content: '',
            tool_calls: [toolCall('get_today_records')],
          })
        : new AIMessage({ content: '你今天喝了 800ml。' });
    });
    const mockModel = buildModel(mockInvoke);

    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_today_records',
        data: { coverage: { status: 'complete' }, rows: [] },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: executeTools as never,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '我今天喝了多少水',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['daily_records'],
    });

    expect(executeTools).toHaveBeenCalledTimes(1);
    // `selectedTools` accumulates across iterations, so the caller can see what
    // the turn actually used — the router used to supply this.
    expect(result.selectedTools).toContain('get_today_records');
    expect(result.toolResults).toHaveLength(1);
    expect(result.finalContent).toBe('你今天喝了 800ml。');
    expect(result.stopReason).toBe('answered');
  });

  it('keeps calling tools across several rounds in one turn', async () => {
    // The reason the router and sub-graphs were removed: one turn must be able
    // to cross domains. Read a record, look up a drug, then answer.
    let call = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new AIMessage({
          content: '',
          tool_calls: [toolCall('get_today_records')],
        });
      }
      if (call === 2) {
        return new AIMessage({
          content: '',
          tool_calls: [toolCall('search_cn_knowledge')],
        });
      }
      return new AIMessage({ content: '综合来看……' });
    });
    const mockModel = buildModel(mockInvoke);

    const executeTools = vi
      .fn()
      .mockResolvedValueOnce([
        {
          name: 'get_today_records',
          data: { coverage: { status: 'complete' } },
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'search_cn_knowledge',
          data: { coverage: { status: 'complete' } },
        },
      ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: executeTools as never,
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '我今天的饮食和这几个药冲突吗',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['daily_records'],
    });

    expect(executeTools).toHaveBeenCalledTimes(2);
    expect(result.selectedTools).toEqual(
      expect.arrayContaining(['get_today_records', 'search_cn_knowledge']),
    );
    expect(result.finalContent).toBe('综合来看……');
    expect(result.stopReason).toBe('answered');
  });

  it('stops at the tool-loop cap and reports it as a visible stop reason', async () => {
    // The model never stops asking. The loop must not spin: it stops at the cap
    // and the stop reason says so, which `respond` turns into an honest reply.
    let call = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      call += 1;
      // Once the cap is hit the graph goes to `validate` → `respond`, and
      // `respond` makes its own model call. That one has to return text; every
      // earlier call keeps asking for a tool.
      return call <= 2
        ? new AIMessage({
            content: '',
            tool_calls: [toolCall('get_today_records')],
          })
        : new AIMessage({
            content: '工具轮次已用尽，先给出目前已知的内容。',
          });
    });
    const mockModel = buildModel(mockInvoke);
    const executeTools = vi.fn().mockResolvedValue([
      {
        name: 'get_today_records',
        data: { coverage: { status: 'complete' } },
      },
    ]);

    const graph = buildAssistantRuntimeGraph({
      createModel: () => mockModel as never,
      executeTools: executeTools as never,
      buildSystemPrompt: () => 'system prompt',
      maxToolLoops: () => 2,
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '一直查下去',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['daily_records'],
    });

    expect(executeTools).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe('tool_cap_reached');
  });

  it('injects cross-conversation memory for a new conversation', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '好的。' }));
    const mockModel = buildModel(mockInvoke);
    const buildMemoryBlock = vi.fn().mockResolvedValue('MEMORY BLOCK');

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
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['health_profile'],
      memoryEnabled: true,
      isNewConversation: true,
    });

    expect(buildMemoryBlock).toHaveBeenCalledWith('user-1');
    expect(result.memoryInjected).toBe(true);
  });

  it('skips memory injection mid-conversation or when memory is disabled', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '好的。' }));
    const buildMemoryBlock = vi.fn().mockResolvedValue('MEMORY BLOCK');

    for (const input of [
      { memoryEnabled: true, isNewConversation: false },
      { memoryEnabled: false, isNewConversation: true },
    ]) {
      const graph = buildAssistantRuntimeGraph({
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: vi.fn(),
        buildSystemPrompt: () => 'system prompt',
        buildMemoryBlock,
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '你好',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['health_profile'],
        ...input,
      });

      expect(result.memoryInjected).toBe(false);
    }
    expect(buildMemoryBlock).not.toHaveBeenCalled();
  });

  it('serves a repeated tool-free message from the response cache', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好，有什么可以帮你？' }));
    const respondCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => buildModel(mockInvoke) as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      respondCache,
    });

    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['health_profile'],
    });

    expect(respondCache.set).toHaveBeenCalledTimes(1);
  });

  it('skips the response cache when memory was injected', async () => {
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好。' }));
    const respondCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const graph = buildAssistantRuntimeGraph({
      createModel: () => buildModel(mockInvoke) as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
      respondCache,
      buildMemoryBlock: () => Promise.resolve('MEMORY'),
    });

    await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['health_profile'],
      memoryEnabled: true,
      isNewConversation: true,
    });

    expect(respondCache.set).not.toHaveBeenCalled();
  });

  it('retries the agent node on a transient LLM error', async () => {
    let attempt = 0;
    const mockInvoke = vi.fn().mockImplementation(() => {
      attempt += 1;
      if (attempt === 1) {
        // Shaped like a provider error: `isRetryableLlmError` classifies by
        // `status` (or by message keywords), so a bare `Error('503 …')` would
        // not be retried.
        return Promise.reject(
          Object.assign(new Error('service unavailable'), { status: 503 }),
        );
      }
      return Promise.resolve(new AIMessage({ content: '恢复了。' }));
    });

    const graph = buildAssistantRuntimeGraph({
      createModel: () => buildModel(mockInvoke) as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '你好',
      locale: 'zh-CN',
      allowedTools: [...TOOL_NAMES],
      enabledContextSources: ['health_profile'],
    });

    expect(attempt).toBeGreaterThan(1);
    expect(result.finalContent).toBe('恢复了。');
  });

  it('does not retry a non-transient LLM error', async () => {
    const mockInvoke = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('bad request'), { status: 400 }),
      );

    const graph = buildAssistantRuntimeGraph({
      createModel: () => buildModel(mockInvoke) as never,
      executeTools: vi.fn(),
      buildSystemPrompt: () => 'system prompt',
    });

    await expect(
      graph.invoke({
        userId: 'user-1',
        userMessage: '你好',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['health_profile'],
      }),
    ).rejects.toThrow(/bad request/);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  describe('validation and stop reasons', () => {
    it('marks the turn no_evidence when every read returns empty coverage', async () => {
      let call = 0;
      const mockInvoke = vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1
          ? new AIMessage({
              content: '',
              tool_calls: [toolCall('get_today_records')],
            })
          : new AIMessage({ content: '没有找到相关记录。' });
      });
      const executeTools = vi
        .fn()
        .mockResolvedValue([emptyEnvelope('get_today_records')]);

      const graph = buildAssistantRuntimeGraph({
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: executeTools as never,
        buildSystemPrompt: () => 'system prompt',
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '查一下我的记录',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['daily_records'],
      });

      // The flags record the evidence gap; the turn still ended with an answer,
      // so the stop reason stays `answered`. `no_evidence` is reserved for turns
      // that ended **without** content — there it is what tells `respond` to say
      // the gap out loud.
      expect(result.validationFlags.hasEmptyResults).toBe(true);
      expect(result.stopReason).toBe('answered');
    });

    it('reports no_evidence when the turn ends without content', async () => {
      // The model reads once, gets nothing, then makes no further tool call. The
      // turn ended without the agent producing text, so `validate` sets
      // `no_evidence` and `respond` writes the reply — the reason survives.
      const mockInvoke = vi
        .fn()
        .mockResolvedValueOnce(
          new AIMessage({
            content: '',
            tool_calls: [toolCall('get_today_records')],
          }),
        )
        // Second call: no tool calls and no text, so `agent` ends with no answer.
        .mockResolvedValueOnce(new AIMessage({ content: '' }))
        // `respond`'s own call then has to say something.
        .mockResolvedValue(new AIMessage({ content: '没有找到相关记录。' }));
      const executeTools = vi
        .fn()
        .mockResolvedValue([emptyEnvelope('get_today_records')]);

      const graph = buildAssistantRuntimeGraph({
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: executeTools as never,
        buildSystemPrompt: () => 'system prompt',
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '查一下我的记录',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['daily_records'],
      });

      expect(result.validationFlags.hasEmptyResults).toBe(true);
      // `respond` had to write the reply, so the stopping reason it inherited
      // from `validate` is what the caller sees.
      expect(result.stopReason).toBe('no_evidence');
      expect(result.finalContent).toBe('没有找到相关记录。');
    });

    it('prefers the cap over an empty result when both apply', async () => {
      // Both conditions hold: the loop ran out AND the results were empty.
      // The cap wins because it is the more actionable fact — the answer is
      // incomplete, not merely evidence-free.
      let call = 0;
      const mockInvoke = vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1
          ? new AIMessage({
              content: '',
              tool_calls: [toolCall('get_today_records')],
            })
          : new AIMessage({ content: '工具轮次已用尽。' });
      });
      const executeTools = vi
        .fn()
        .mockResolvedValue([emptyEnvelope('get_today_records')]);

      const graph = buildAssistantRuntimeGraph({
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: executeTools as never,
        buildSystemPrompt: () => 'system prompt',
        maxToolLoops: () => 1,
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '查一下我的记录',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['daily_records'],
      });

      expect(result.validationFlags.hasEmptyResults).toBe(true);
      expect(result.stopReason).toBe('tool_cap_reached');
    });

    it('marks the turn no_target when a write tool produced no proposal', async () => {
      let call = 0;
      const mockInvoke = vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1
          ? new AIMessage({
              content: '',
              tool_calls: [toolCall('update_record_draft')],
            })
          : new AIMessage({ content: '没能定位到要修改的记录。' });
      });
      const executeTools = vi
        .fn()
        .mockResolvedValue([{ name: 'update_record_draft', data: {} }]);

      const graph = buildAssistantRuntimeGraph({
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: executeTools as never,
        buildSystemPrompt: () => 'system prompt',
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '把今天的饮水改成 1000',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['daily_records'],
      });

      expect(result.validationFlags.missingProposedActions).toBe(true);
      expect(result.stopReason).toBe('no_target');
    });

    it('skips in-graph review without a checkpointer', async () => {
      let call = 0;
      const mockInvoke = vi.fn().mockImplementation(() => {
        call += 1;
        return call === 1
          ? new AIMessage({
              content: '',
              tool_calls: [toolCall('create_record_draft')],
            })
          : new AIMessage({ content: '这是一份待确认的草稿。' });
      });
      const executeTools = vi.fn().mockResolvedValue([
        {
          name: 'create_record_draft',
          data: {},
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
        createModel: () => buildModel(mockInvoke) as never,
        executeTools: executeTools as never,
        buildSystemPrompt: () => 'system prompt',
      });

      const result = await graph.invoke({
        userId: 'user-1',
        userMessage: '帮我记录今天喝水 500ml',
        locale: 'zh-CN',
        allowedTools: [...TOOL_NAMES],
        enabledContextSources: ['health_profile'],
      });

      // No checkpointer → no review nodes: the write flow replies directly.
      expect(result.pendingReview).toBeUndefined();
      expect(result.stopReason).not.toBe('awaiting_review');
      expect(result.finalContent).toBe('这是一份待确认的草稿。');
      expect('__interrupt__' in result).toBe(false);
    });
  });
});
