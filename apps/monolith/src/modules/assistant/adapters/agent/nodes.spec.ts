import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { createAgentNode } from './nodes.js';

/** State defaults the real graph always supplies; a case names only what it changes. */
function stateWith(overrides: Record<string, unknown>) {
  return {
    allowedTools: [],
    selectedTools: [],
    messages: [],
    ...overrides,
  } as never;
}

describe('assistant agent node', () => {
  it('forwards model text chunks while returning the aggregated final response', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: 'Hello' });
      yield new AIMessageChunk({ content: ' world' });
    }

    const invoke = vi.fn();
    const stream = vi.fn().mockResolvedValue(buildStream());
    const model = {
      bindTools: vi.fn().mockReturnValue({ invoke, stream }),
    };
    const onText = vi.fn();
    const node = createAgentNode({
      createModel: () => model as never,
      onText,
    } as never);

    const result = await node(
      stateWith({
        allowedTools: ['get_user_profile'],
        messages: [new HumanMessage('hello')],
      }),
    );

    expect(result).toMatchObject({
      finalContent: 'Hello world',
      pendingToolCalls: [],
      stopReason: 'answered',
    });
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' world');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('binds every allowed tool rather than a pre-selected subset', async () => {
    // The node used to bind `relevantTools`, a subset the router had chosen.
    // Now the whole permission-filtered set is bound and the model decides.
    const allowed = [
      'get_user_profile',
      'search_cn_medicine_knowledge',
    ] as const;
    const stream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: 'ok' });
      })(),
    );
    const model = { bindTools: vi.fn().mockReturnValue({ stream }) };
    const node = createAgentNode({
      createModel: () => model as never,
    } as never);

    await node(stateWith({ allowedTools: [...allowed] }));

    const bound = model.bindTools.mock.calls[0]?.[0] as Array<{
      function: { name: string };
    }>;
    expect(bound.map((definition) => definition.function.name)).toEqual([
      ...allowed,
    ]);
  });

  it('treats an empty model reply as no answer rather than an answer of ""', async () => {
    // `respond` throws on empty content; storing `''` here would make a turn
    // that never said anything look finished.
    const stream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield new AIMessageChunk({ content: '' });
      })(),
    );
    const model = { bindTools: vi.fn().mockReturnValue({ stream }) };
    const node = createAgentNode({
      createModel: () => model as never,
    } as never);

    const result = await node(
      stateWith({ allowedTools: ['get_user_profile'] }),
    );

    expect(result).toMatchObject({ finalContent: null, stopReason: null });
  });

  it('short-circuits to no_match when nothing may be bound', async () => {
    const model = { bindTools: vi.fn() };
    const node = createAgentNode({
      createModel: () => model as never,
    } as never);

    const result = await node(stateWith({ allowedTools: [] }));

    expect(result).toMatchObject({
      pendingToolCalls: [],
      finalContent: null,
      stopReason: 'no_match',
    });
    expect(model.bindTools).not.toHaveBeenCalled();
  });
});
