import {
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { streamModelResponse } from './model-stream';

async function* chunks(values: AIMessageChunk[]) {
  for (const value of values) {
    await Promise.resolve();
    yield value;
  }
}

describe('streamModelResponse', () => {
  it('forwards text deltas and aggregates the final message', async () => {
    const stream = vi
      .fn()
      .mockResolvedValue(
        chunks([
          new AIMessageChunk({ content: 'Hello' }),
          new AIMessageChunk({ content: ' world' }),
        ]),
      );
    const onText = vi.fn();

    const result = await streamModelResponse(
      { stream },
      [new HumanMessage('hello')] as BaseMessage[],
      onText,
    );

    expect(result.content).toBe('Hello world');
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' world');
  });

  it('preserves tool calls from the aggregated message', async () => {
    const stream = vi.fn().mockResolvedValue(
      chunks([
        new AIMessageChunk({
          content: '',
          tool_calls: [{ name: 'get_user_profile', args: {}, id: 'call-1' }],
        }),
      ]),
    );

    const result = await streamModelResponse({ stream }, [
      new HumanMessage('check my profile'),
    ] as BaseMessage[]);

    expect(result.tool_calls).toEqual([
      { name: 'get_user_profile', args: {}, id: 'call-1' },
    ]);
  });

  it('rejects a stream without an AI message chunk', async () => {
    const stream = vi.fn().mockResolvedValue(
      (async function* () {
        await Promise.resolve();
        yield { content: 'not an AI chunk' };
      })(),
    );

    await expect(
      streamModelResponse({ stream }, [
        new HumanMessage('hello'),
      ] as BaseMessage[]),
    ).rejects.toThrow(/without any AI message chunks/);
  });
});
