/**
 * `Message` — the entity inside the `Conversation` aggregate (ADR-0024 §4).
 *
 * A persisted assistant message is not a plain row: three of its properties were
 * decided by the runtime and are read by the client, and each of them used to be
 * re-derived at every boundary.
 *
 * - **`role`** is a closed two-value set. Anything else is not a message this
 *   context can reason about, so loading one fails loudly instead of letting a
 *   third value travel into the prompt.
 * - **`createdAt` strictly increases** across a conversation. Postgres's `now()`
 *   resolves to the transaction start, so a user message and the assistant reply
 *   written in the same transaction share a millisecond and read back in an
 *   unstable order (the archived conversations that showed a reply above its
 *   question). The ordering is therefore an aggregate invariant (see
 *   `conversation.ts`), not something the writer happens to do.
 * - **`usedTools` is a list of names**, normalized on the way in: the column is
 *   JSON, so a row written by an older shape can hold anything.
 *
 * ## Prose messages vs stored messages
 *
 * Two shapes are modelled and they are deliberately distinct. A *prose* message
 * (`ConversationMessage`) is what a client sends — role plus text, nothing else —
 * and it carries no identity, because the client cannot know the ids the server
 * will assign. A *stored* message (`StoredConversationMessage`) is what came back
 * from persistence. Conflating them lets a caller hand an input an id it
 * invented.
 */

/** Who produced a message. */
export type MessageRole = 'user' | 'assistant';

export const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'assistant'];

/** Message as the client sends it: no identity, no timestamps. */
export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

/** Message as persistence returns it. */
export interface StoredConversationMessage extends ConversationMessage {
  id: string;
  usedTools: readonly string[];
  createdAt: Date;
}

export function isMessageRole(value: unknown): value is MessageRole {
  return (
    typeof value === 'string' &&
    (MESSAGE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Normalizes a client message.
 *
 * Trimming happens here rather than at the transport because the trimmed text is
 * what the dedup rule compares: two messages that differ only in leading
 * whitespace are the same message, and a drift in the boundary would make a
 * replayed conversation append a duplicate.
 *
 * Returns `null` for content that is empty after trimming — such a message is
 * not stored, and callers drop it before touching the aggregate.
 */
export function normalizeMessage(
  message: ConversationMessage,
): ConversationMessage | null {
  const content = message.content.trim();
  if (content.length === 0) {
    return null;
  }
  return { role: message.role, content };
}

/** Normalizes a client-supplied list: trims and drops empty messages. */
export function normalizeMessages(
  messages: readonly ConversationMessage[],
): ConversationMessage[] {
  return messages.flatMap((message) => {
    const normalized = normalizeMessage(message);
    return normalized == null ? [] : [normalized];
  });
}

/**
 * Reads `usedTools` off a persisted row.
 *
 * The column is JSON with no shape guarantee at the database level, so a legacy
 * row can contain objects or numbers. Non-string entries are dropped rather than
 * stringified: a fabricated tool name would render in the client's source strip
 * as if the tool had run.
 */
export function readUsedTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((tool): tool is string => typeof tool === 'string');
}

/**
 * Index of the first incoming message that is not already persisted.
 *
 * Replaying a conversation sends its whole history, so persistence must append
 * only the new suffix. The comparison stops at the first mismatch — a
 * conversation cannot be edited in the middle (the aggregate offers no such
 * operation), so a mismatch means "everything from here is new".
 */
export function findAppendStartIndex(
  existing: readonly ConversationMessage[],
  incoming: readonly ConversationMessage[],
): number {
  let matched = 0;
  while (matched < existing.length && matched < incoming.length) {
    const a = existing[matched];
    const b = incoming[matched];
    if (a == null || b == null || a.role !== b.role || a.content !== b.content) {
      break;
    }
    matched += 1;
  }
  return matched;
}
