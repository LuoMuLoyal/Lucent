/**
 * `Conversation` aggregate root (ADR-0024 §4) — AI Assistant context.
 *
 * A conversation is an ordered list of messages plus the thread-level facts the
 * client renders (title, status, activity timestamps). It owns four rules that
 * used to be scattered across the repository, the application service and the
 * SQL writer:
 *
 * 1. **Messages are ordered and the order is total.** `createdAt` strictly
 *    increases. This is a real defect seen in production: the user message and
 *    the assistant reply were written in the same transaction, Postgres's `now()`
 *    resolved both to the transaction start, and a read ordered by `createdAt`
 *    then put the reply above its question. The aggregate assigns the timestamps,
 *    so the ordering cannot depend on what the writer passes in.
 *
 * 2. **Only `active` conversations are current.** Activating one archives the
 *    previous one; the client keeps exactly one open thread.
 *
 * 3. **`deleted` is terminal.** Reopen, rename, delete-again and append all
 *    refuse on a deleted conversation. Treating a second delete as a no-op is how
 *    a soft-deleted thread reappears in a list.
 *
 * 4. **Titles are bounded.** The synchronous title is the first user message
 *    truncated to {@link MAX_CONVERSATION_TITLE_LENGTH}; the LLM refinement is
 *    clamped to {@link MAX_REFINED_TITLE_LENGTH}; a rename must be non-empty and
 *    at most {@link MAX_RENAME_TITLE_LENGTH} characters.
 *
 * ## What is *not* here
 *
 * The LLM title refinement is an application concern (it calls a model), the
 * "do not overwrite a title the user already replaced" race re-reads the row so
 * it is an application concern too, and the message→checkpoint mapping of
 * regeneration is a persistence concern. The aggregate keeps only the rules that
 * hold no matter who calls it or where the data lives.
 *
 * ## Layer purity
 *
 * ADR-0024 rule D1: `domain/` imports nothing outside `domain/`. Rejected
 * operations therefore return typed `ConversationRule` values instead of throwing
 * framework exceptions, and the application layer maps them onto the registered
 * `DomainFailure` codes (ADR-0012) — leaving the mapping visible at the boundary
 * instead of hidden inside the aggregate.
 */

import {
  type ConversationMessage,
  type MessageRole,
  type StoredConversationMessage,
  findAppendStartIndex,
  normalizeMessages,
} from './message.js';

/** Lifecycle of a conversation. `deleted` is terminal. */
export type ConversationStatus = 'active' | 'archived' | 'deleted';

export const CONVERSATION_STATUSES: readonly ConversationStatus[] = [
  'active',
  'archived',
  'deleted',
];

/** Initial title = first user message, truncated to this many characters. */
export const MAX_CONVERSATION_TITLE_LENGTH = 60;

/** LLM-refined titles are clamped to this many characters. */
export const MAX_REFINED_TITLE_LENGTH = 20;

/** A rename must be non-empty and no longer than this. */
export const MAX_RENAME_TITLE_LENGTH = 48;

/**
 * Why an operation was refused.
 *
 * A closed union rather than an exception so the transport mapping stays in the
 * application layer and stays exhaustive.
 */
export type ConversationRule =
  | 'conversation_not_found'
  | 'conversation_deleted'
  | 'title_empty'
  | 'title_too_long'
  | 'empty_assistant_reply';

/** Snapshot of one conversation as the aggregate sees it. */
export interface ConversationState {
  id: string;
  userId: string;
  title: string | null;
  status: ConversationStatus;
  messages: readonly StoredConversationMessage[];
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A stored message to append within a turn, ordered by `createdAt`. */
export interface AppendedMessage {
  role: MessageRole;
  content: string;
  usedTools: readonly string[];
  createdAt: Date;
}

/** What persisting one turn must write: user messages, then the reply. */
export interface ConversationTurn {
  conversationId: string;
  userId: string;
  messages: readonly AppendedMessage[];
  /** Title to persist — the initial truncation when the row still has none. */
  title: string | null;
  /** Timestamp of the reply; also the conversation's new `lastMessageAt`. */
  assistantAt: Date;
}

/**
 * Repairs rule 1 for rows written before it existed.
 *
 * Older rows can share a millisecond (two messages in one transaction) or even an
 * identical timestamp. They are re-spaced forward from the first violation, so
 * the read order is what the aggregate promises. Only the returned view changes —
 * this never rewrites a row, because a cosmetic ordering fix is not worth a
 * migration over user data.
 */
export function orderMessages(
  messages: readonly StoredConversationMessage[],
): StoredConversationMessage[] {
  const ordered: StoredConversationMessage[] = [];
  for (const message of messages) {
    const previous = ordered.at(-1);
    if (
      previous != null &&
      message.createdAt.getTime() <= previous.createdAt.getTime()
    ) {
      ordered.push({
        ...message,
        createdAt: new Date(previous.createdAt.getTime() + 1),
      });
      continue;
    }
    ordered.push(message);
  }
  return ordered;
}

export class Conversation {
  private readonly state: ConversationState;

  private constructor(state: ConversationState) {
    this.state = state;
  }

  /** Rehydrates the aggregate from persistence. */
  static fromState(state: ConversationState): Conversation {
    return new Conversation({
      ...state,
      messages: orderMessages(state.messages),
    });
  }

  /** Creates a brand-new conversation: `active`, empty, no activity yet. */
  static create(input: {
    id: string;
    userId: string;
    title: string | null;
    createdAt: Date;
  }): Conversation {
    return new Conversation({
      id: input.id,
      userId: input.userId,
      title: input.title,
      status: 'active',
      messages: [],
      lastMessageAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  get status(): ConversationStatus {
    return this.state.status;
  }

  get title(): string | null {
    return this.state.title;
  }

  get lastMessageAt(): Date | null {
    return this.state.lastMessageAt;
  }

  /** Read access to the full state, for persistence and the response snapshot. */
  snapshot(): ConversationState {
    return this.state;
  }

  isDeleted(): boolean {
    return this.state.status === 'deleted';
  }

  /**
   * Rule 3: a deleted conversation accepts no further operation.
   *
   * Every mutating use case calls this first, so the terminal status is enforced
   * once instead of being re-checked per operation at the call site.
   */
  validate(): ConversationRule | null {
    return this.isDeleted() ? 'conversation_deleted' : null;
  }

  /** Rule 2: makes this conversation the current one. */
  activate(): ConversationRule | null {
    const problem = this.validate();
    if (problem != null) {
      return problem;
    }
    this.state.status = 'active';
    return null;
  }

  /** Archives the conversation (the "clear latest" path). */
  archive(): ConversationRule | null {
    const problem = this.validate();
    if (problem != null) {
      return problem;
    }
    this.state.status = 'archived';
    return null;
  }

  /**
   * Rule 3: soft delete. On an already-deleted conversation it is refused, so a
   * repeated delete renders as `RESOURCE_NOT_FOUND` rather than resurrecting the
   * thread.
   */
  softDelete(): ConversationRule | null {
    const problem = this.validate();
    if (problem != null) {
      return problem;
    }
    this.state.status = 'deleted';
    return null;
  }

  /** Rule 4: a rename must be non-empty and bounded. */
  rename(title: string): ConversationRule | null {
    const problem = this.validate();
    if (problem != null) {
      return problem;
    }
    const normalized = title.trim();
    if (normalized.length === 0) {
      return 'title_empty';
    }
    if (normalized.length > MAX_RENAME_TITLE_LENGTH) {
      return 'title_too_long';
    }
    this.state.title = normalized;
    return null;
  }

  /**
   * Rule 4, refinement half: the LLM title may only replace the synchronous
   * truncation it was asked to refine. `currentTitle` is what the caller read
   * back after the model call; a mismatch means the user renamed in between and
   * the model's suggestion must be dropped.
   */
  canApplyRefinedTitle(currentTitle: string | null): boolean {
    return !this.isDeleted() && this.state.title === currentTitle;
  }

  /** Applies a refined title; refuses when rule 4 forbids it. */
  applyRefinedTitle(currentTitle: string | null, refined: string): boolean {
    if (!this.canApplyRefinedTitle(currentTitle)) {
      return false;
    }
    this.state.title = refined;
    return true;
  }

  /** Prose view of the history — what {@link planTurn} deduplicates against. */
  history(): ConversationMessage[] {
    return this.state.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  /**
   * Rules 1 + 4: plans the append of one turn.
   *
   * `incoming` is the whole conversation the client replayed; only the suffix
   * past the persisted history is new (`findAppendStartIndex`). The reply is
   * written last and each user message is placed strictly before it, one
   * millisecond apart — that spacing is why rule 1 survives a single
   * transaction, where the database default would collapse both to `now()`.
   *
   * The aggregate performs no I/O: it returns the plan and the caller persists it.
   */
  planTurn(input: {
    incoming: readonly ConversationMessage[];
    assistantContent: string;
    usedTools: readonly string[];
    assistantAt: Date;
  }): { rule: ConversationRule } | { turn: ConversationTurn } {
    const problem = this.validate();
    if (problem != null) {
      return { rule: problem };
    }

    const reply = input.assistantContent.trim();
    if (reply.length === 0) {
      // An empty reply cannot be told apart from a dropped one at read time.
      return { rule: 'empty_assistant_reply' };
    }

    const incoming = normalizeMessages(input.incoming);
    const appendFrom = findAppendStartIndex(this.history(), incoming);
    const newUserMessages = incoming.slice(appendFrom);
    const title = this.state.title ?? buildInitialTitle(incoming);

    const messages: AppendedMessage[] = [
      ...newUserMessages.map((message, index) => ({
        role: message.role,
        content: message.content,
        usedTools: [] as readonly string[],
        createdAt: new Date(
          input.assistantAt.getTime() - (newUserMessages.length - index),
        ),
      })),
      {
        role: 'assistant' as const,
        content: reply,
        usedTools: [...input.usedTools],
        createdAt: input.assistantAt,
      },
    ];

    return {
      turn: {
        conversationId: this.state.id,
        userId: this.state.userId,
        messages,
        title,
        assistantAt: input.assistantAt,
      },
    };
  }

  /**
   * Records an applied turn, so a snapshot built from this aggregate matches what
   * persistence now holds. `ids` are the row ids persistence assigned, in the
   * same order as `turn.messages`.
   */
  applyTurn(turn: ConversationTurn, ids: readonly string[]): void {
    const appended = turn.messages.map((message, index) => ({
      id: ids[index] ?? '',
      role: message.role,
      content: message.content,
      usedTools: message.usedTools,
      createdAt: message.createdAt,
    }));
    this.state.messages = orderMessages([...this.state.messages, ...appended]);
    this.state.title = turn.title;
    this.state.lastMessageAt = turn.assistantAt;
  }

  /**
   * Rule 1 for a regenerated answer: it is appended after the previous one and
   * becomes the conversation's activity timestamp. The old answer stays —
   * regeneration forks the thread, it does not overwrite the record.
   */
  planStandaloneAssistantMessage(input: {
    content: string;
    at: Date;
  }): { rule: ConversationRule } | { message: AppendedMessage } {
    const problem = this.validate();
    if (problem != null) {
      return { rule: problem };
    }
    const content = input.content.trim();
    if (content.length === 0) {
      return { rule: 'empty_assistant_reply' };
    }
    return {
      message: {
        role: 'assistant',
        content,
        usedTools: [],
        createdAt: input.at,
      },
    };
  }

  /** Records an applied standalone assistant message. */
  applyStandaloneAssistantMessage(message: AppendedMessage, id: string): void {
    this.state.messages = orderMessages([
      ...this.state.messages,
      { ...message, id },
    ]);
    this.state.lastMessageAt = message.createdAt;
  }
}

/**
 * Rule 4: the synchronous title is the first user message, whitespace-collapsed
 * and truncated. `null` when the turn carries no user message.
 */
export function buildInitialTitle(
  messages: readonly ConversationMessage[],
): string | null {
  const first = messages.find((message) => message.role === 'user');
  if (first == null) {
    return null;
  }
  const compact = first.content.replace(/\s+/g, ' ').trim();
  if (compact.length === 0) {
    return null;
  }
  return truncate(compact, MAX_CONVERSATION_TITLE_LENGTH);
}

/**
 * Rule 4, refinement half: clamps the model's title output. Surrounding
 * quotes/backticks are stripped and whitespace collapsed, because models wrap
 * titles in both; `null` means "keep the synchronous truncation".
 */
export function normalizeRefinedTitle(content: unknown): string | null {
  if (typeof content !== 'string') {
    return null;
  }
  let title = content.trim().replace(/^[`"“”']+|[`"“”']+$/g, '');
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length === 0) {
    return null;
  }
  return truncate(title, MAX_REFINED_TITLE_LENGTH);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
