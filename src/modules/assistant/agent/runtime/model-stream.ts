import { Logger } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages';
import { extractMessageText } from './message-text.utils';

export type StreamableModel = {
  stream(input: BaseMessage[]): Promise<AsyncIterable<unknown>>;
};

export async function streamModelResponse(
  model: StreamableModel,
  messages: BaseMessage[],
  onText?: (text: string) => void | Promise<void>,
): Promise<AIMessage> {
  const stream = await model.stream(messages);
  let aggregated: AIMessageChunk | null = null;

  for await (const chunk of stream) {
    if (!AIMessageChunk.isInstance(chunk)) {
      continue;
    }

    const text = extractMessageText(chunk.content);
    if (text.length > 0 && onText != null) {
      try {
        await onText(text);
      } catch (error) {
        // Transport-layer failures (e.g. SSE client disconnect) must not tear
        // down the whole stream. Keep aggregating the final message and let the
        // caller handle downstream delivery in its own error handling.
        Logger.error(
          `Assistant stream onText callback failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
          'streamModelResponse',
        );
      }
    }

    aggregated = aggregated == null ? chunk : aggregated.concat(chunk);
  }

  if (aggregated == null) {
    throw new Error('Assistant stream ended without any AI message chunks.');
  }

  return new AIMessage({
    content: aggregated.content,
    tool_calls: aggregated.tool_calls,
    invalid_tool_calls: aggregated.invalid_tool_calls,
    usage_metadata: aggregated.usage_metadata,
    id: aggregated.id,
    name: aggregated.name,
    additional_kwargs: aggregated.additional_kwargs,
    response_metadata: aggregated.response_metadata,
  } as never);
}
