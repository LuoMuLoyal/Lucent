import { AIMessageChunk } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { MAX_TOOL_LOOPS } from '../../tools/shared/tool-constants.js';
import { buildRespondNode } from './respond.js';

function stateWith(overrides: Record<string, unknown>) {
  return overrides as never;
}

describe('respond node', () => {
  it('returns unchanged when finalContent is already present', async () => {
    const mockInvoke = vi.fn();
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke }) as never,
    });

    const result = await respond(
      stateWith({ finalContent: 'already answered', messages: [] }),
    );

    expect(result).toEqual({});
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('produces content with a tool-free LLM call when finalContent is null', async () => {
    const mockInvoke = vi.fn();
    const mockStream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: '你好，有什么可以帮你？' });
      })(),
    );
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke, stream: mockStream }) as never,
    });

    const result = await respond(
      stateWith({
        finalContent: null,
        messages: [],
        pendingToolCalls: [],
        loopCount: 0,
      }),
    );

    expect(result).toEqual({
      finalContent: '你好，有什么可以帮你？',
      stopReason: 'answered',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it('forwards model text chunks when finalContent is null', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: '你好' });
      yield new AIMessageChunk({ content: '，助手。' });
    }

    const invoke = vi.fn();
    const stream = vi.fn().mockResolvedValue(buildStream());
    const onText = vi.fn();
    const respond = buildRespondNode({
      createModel: () => ({ invoke, stream }) as never,
      onText,
    } as never);

    const result = await respond(
      stateWith({
        finalContent: null,
        messages: [],
        pendingToolCalls: [],
        loopCount: 0,
      }),
    );

    expect(result).toEqual({
      finalContent: '你好，助手。',
      stopReason: 'answered',
    });
    expect(onText).toHaveBeenNthCalledWith(1, '你好');
    expect(onText).toHaveBeenNthCalledWith(2, '，助手。');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects blank pre-generated content', async () => {
    const respond = buildRespondNode({
      createModel: () => ({ invoke: vi.fn() }) as never,
    });

    await expect(
      respond(stateWith({ finalContent: '   ', messages: [] })),
    ).rejects.toThrow(/without any assistant content/);
  });

  it('rejects an empty LLM reply', async () => {
    const mockInvoke = vi.fn();
    const mockStream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: ' ' });
      })(),
    );
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke, stream: mockStream }) as never,
    });

    await expect(
      respond(
        stateWith({
          finalContent: null,
          messages: [],
          pendingToolCalls: [],
          loopCount: 0,
        }),
      ),
    ).rejects.toThrow(/without any assistant content/);
  });

  it('appends a fallback instruction when the tool loop budget is exhausted with pending tool calls', async () => {
    const mockInvoke = vi.fn();
    const mockStream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: '工具轮次已耗尽' });
      })(),
    );
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke, stream: mockStream }) as never,
    });

    const result = await respond(
      stateWith({
        finalContent: null,
        messages: [],
        pendingToolCalls: ['search_medicine_leaflets'],
        loopCount: MAX_TOOL_LOOPS,
        intent: 'mixed',
        memoryInjected: false,
        toolResults: [],
        userMessage: '查一下阿司匹林的说明书',
        locale: 'zh-CN',
      }),
    );

    expect(result).toEqual({
      finalContent: '工具轮次已耗尽',
      stopReason: 'answered',
    });
    expect(mockStream).toHaveBeenCalledTimes(1);
    const sentMessages = mockStream.mock.calls[0]![0] as unknown[];
    expect(sentMessages).toHaveLength(1);
    const system = sentMessages[0] as { content: string };
    expect(system.content).toContain('tool loop budget');
    expect(system.content).toContain('exhausted');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does not append the fallback instruction while the tool loop budget remains', async () => {
    const mockInvoke = vi.fn();
    const mockStream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: 'ok' });
      })(),
    );
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke, stream: mockStream }) as never,
    });

    await respond(
      stateWith({
        finalContent: null,
        messages: [],
        pendingToolCalls: ['search_medicine_leaflets'],
        loopCount: MAX_TOOL_LOOPS - 1,
      }),
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const sentMessages = mockStream.mock.calls[0]![0] as unknown[];
    expect(sentMessages).toHaveLength(0);
  });

  it('does not append the fallback instruction when no tool calls are pending', async () => {
    const mockInvoke = vi.fn();
    const mockStream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: 'ok' });
      })(),
    );
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke, stream: mockStream }) as never,
    });

    await respond(
      stateWith({
        finalContent: null,
        messages: [],
        pendingToolCalls: [],
        loopCount: MAX_TOOL_LOOPS,
      }),
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const sentMessages = mockStream.mock.calls[0]![0] as unknown[];
    expect(sentMessages).toHaveLength(0);
  });
});
