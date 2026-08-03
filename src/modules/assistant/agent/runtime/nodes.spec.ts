import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { createAgentNode } from './nodes';

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

    const result = await node({
      relevantTools: ['get_user_profile'],
      messages: [new HumanMessage('hello')],
    } as never);

    expect(result).toMatchObject({
      finalContent: 'Hello world',
      pendingToolCalls: [],
      stopReason: 'answered',
    });
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' world');
    expect(invoke).not.toHaveBeenCalled();
  });
});
