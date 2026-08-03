import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages';

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

    const text = readChunkText(chunk);
    if (text.length > 0 && onText != null) {
      await onText(text);
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

function readChunkText(chunk: AIMessageChunk): string {
  if (typeof chunk.content === 'string') {
    return chunk.content;
  }

  if (!Array.isArray(chunk.content)) {
    return '';
  }

  return chunk.content
    .map((part) =>
      typeof part === 'string'
        ? part
        : 'text' in part && typeof part.text === 'string'
          ? part.text
          : '',
    )
    .join('');
}
