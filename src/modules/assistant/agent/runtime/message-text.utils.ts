/**
 * Extracts plain text from a LangChain message content value.
 *
 * Supports both string content and content-part arrays that carry a `text`
 * field (e.g. OpenAI-style message chunks). Used across the assistant runtime
 * so streaming aggregation and final response formatting stay consistent.
 */
export function extractMessageText(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part: unknown) => {
      if (typeof part === 'string') {
        return part;
      }
      if (
        part != null &&
        typeof part === 'object' &&
        Object.prototype.hasOwnProperty.call(part, 'text')
      ) {
        const textValue = (part as Record<string, unknown>)['text'];
        if (typeof textValue === 'string') {
          return textValue;
        }
      }
      return '';
    })
    .join('');
}
