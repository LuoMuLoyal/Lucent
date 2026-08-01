import { AIMessage } from '@langchain/core/messages';
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
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: '你好，有什么可以帮你？' }));
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke }) as never,
    });

    const result = await respond(
      stateWith({ finalContent: null, messages: [] }),
    );

    expect(result).toEqual({
      finalContent: '你好，有什么可以帮你？',
      stopReason: 'answered',
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
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
    const mockInvoke = vi
      .fn()
      .mockResolvedValue(new AIMessage({ content: ' ' }));
    const respond = buildRespondNode({
      createModel: () => ({ invoke: mockInvoke }) as never,
    });

    await expect(
      respond(stateWith({ finalContent: null, messages: [] })),
    ).rejects.toThrow(/without any assistant content/);
  });
});
