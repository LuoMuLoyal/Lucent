import { Logger } from '@nestjs/common';
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

  it('continues aggregating when onText throws a transport error', async () => {
    const loggerError = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const stream = vi
      .fn()
      .mockResolvedValue(
        chunks([
          new AIMessageChunk({ content: 'Hello' }),
          new AIMessageChunk({ content: ' world' }),
        ]),
      );
    const transportErr = new Error('write EPIPE') as Error & {
      code: string;
    };
    transportErr.code = 'EPIPE';
    const onText = vi.fn().mockRejectedValueOnce(transportErr);

    const result = await streamModelResponse(
      { stream },
      [new HumanMessage('hello')] as BaseMessage[],
      onText,
    );

    expect(result.content).toBe('Hello world');
    expect(onText).toHaveBeenCalledTimes(2);
    expect(loggerError).toHaveBeenCalledWith(
      'Assistant stream onText callback failed (transport): write EPIPE',
      expect.any(String),
      'streamModelResponse',
    );

    loggerError.mockRestore();
  });

  it('rethrows non-transport errors from onText', async () => {
    const loggerError = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const stream = vi
      .fn()
      .mockResolvedValue(
        chunks([
          new AIMessageChunk({ content: 'Hello' }),
          new AIMessageChunk({ content: ' world' }),
        ]),
      );
    const onText = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('bad callback logic'));

    await expect(
      streamModelResponse(
        { stream },
        [new HumanMessage('hello')] as BaseMessage[],
        onText,
      ),
    ).rejects.toThrow(TypeError);

    expect(onText).toHaveBeenCalledTimes(1);
    expect(loggerError).not.toHaveBeenCalled();

    loggerError.mockRestore();
  });
});
