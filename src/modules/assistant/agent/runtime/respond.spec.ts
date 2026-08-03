import { AIMessageChunk } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { buildRespondNode } from './respond';

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
      stateWith({ finalContent: null, messages: [] }),
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
      stateWith({ finalContent: null, messages: [] }),
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
      respond(stateWith({ finalContent: null, messages: [] })),
    ).rejects.toThrow(/without any assistant content/);
  });
});
