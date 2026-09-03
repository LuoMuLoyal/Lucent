import { Logger } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages';
import { extractMessageText } from './message-text.utils.js';

export type StreamableModel = {
  stream(input: BaseMessage[]): Promise<AsyncIterable<unknown>>;
};

/**
 * Errno / error codes that indicate a transport-layer failure (client
 * disconnect, broken pipe, premature stream close) rather than a bug in
 * callback logic. Only these are swallowed so the stream can keep
 * aggregating the final message for the caller.
 */
const TRANSPORT_ERRNO_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_HTTP_HEADERS_SENT',
]);

/**
 * Determines whether an error thrown by the `onText` callback is a
 * transport-layer failure (e.g. SSE client disconnect) that should be
 * swallowed, or a programming / business error that must bubble up.
 */
function isTransportError(error: unknown): boolean {
  if (
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  ) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  // AbortError — fetch/stream explicitly aborted by the caller.
  if (error.name === 'AbortError') {
    return true;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (code != null && TRANSPORT_ERRNO_CODES.has(code)) {
    return true;
  }

  return false;
}

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
        // Only transport-layer failures (e.g. SSE client disconnect, broken
        // pipe) are swallowed so the stream can keep aggregating the final
        // message. Programming errors (TypeError etc.) and business logic
        // errors must propagate so they are not silently hidden.
        if (!isTransportError(error)) {
          throw error;
        }

        Logger.error(
          `Assistant stream onText callback failed (transport): ${
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
