/**
 * Write-side repository port for the `Conversation` aggregate
 * (`domain/conversation/conversation.ts`, ADR-0024 §4).
 *
 * One repository per aggregate root, serving **load/save for the write side** —
 * the three reads at the bottom are the exceptions this context needs, and each
 * names a concrete question rather than exposing a query DSL:
 *
 * - `listRecent` returns the conversation list, a read model that never loads
 *   message history (the client renders titles and timestamps only);
 * - `findRecentRegeneration` answers the idempotency question for one message.
 *
 * Layer purity (ADR-0024 rule D1): only `domain/` types.
 */

import type {
  AppendedMessage,
  Conversation,
  ConversationState,
  ConversationStatus,
  ConversationTurn,
} from './conversation.js';

/** DI token — string so a Nest resolution error names the port readably. */
export const ASSISTANT_CONVERSATIONS = 'ASSISTANT_CONVERSATIONS';

/** Idempotency window for duplicate regenerations of the same message. */
export const REGENERATION_IDEMPOTENCY_WINDOW_MS = 30_000;

/** A conversation as the list endpoint shows it: no messages. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRepositoryPort {
  /** Loads one conversation of this user; a deleted one counts as missing. */
  find(
    userId: string,
    conversationId: string,
  ): Promise<ConversationState | null>;

  /** The user's single `active` conversation, or `null` when none is open. */
  findActive(userId: string): Promise<ConversationState | null>;

  /** Persists a brand-new conversation; returns it as stored. */
  create(input: {
    id: string;
    userId: string;
    title: string | null;
  }): Promise<ConversationState>;

  /** Persists the aggregate after a rule was applied to it. */
  save(conversation: Conversation): Promise<ConversationState>;

  /**
   * Rule 2 persistence: archives every other active conversation of the user and
   * marks this one active, in one transaction.
   *
   * Two rows change here, so this cannot be expressed as "save one aggregate" —
   * the port owns the transaction, which is exactly why it is an explicit method.
   */
  activate(userId: string, conversationId: string): Promise<void>;

  /** Rule 1 persistence: inserts the turn's messages and bumps the activity. */
  appendTurn(turn: ConversationTurn): Promise<ConversationState>;

  /** Appends one standalone assistant message (the regeneration path). */
  appendAssistantMessage(
    userId: string,
    conversationId: string,
    message: AppendedMessage,
  ): Promise<ConversationState>;

  /** The recent-conversation list (read model; no message history). */
  listRecent(userId: string, limit: number): Promise<ConversationSummary[]>;

  /** Latest regeneration record for the message, inside the idempotency window. */
  findRecentRegeneration(
    conversationId: string,
    sourceMessageId: string,
  ): Promise<{ id: string; createdAt: Date } | null>;

  /**
   * Records the message→checkpoint mapping of a regeneration request.
   *
   * `checkpointId` is opaque here: it belongs to the graph runtime, and the
   * conversation aggregate has no business knowing what a checkpoint is.
   */
  createRegeneration(input: {
    conversationId: string;
    userId: string;
    sourceMessageId: string;
    checkpointId: string;
  }): Promise<{ id: string }>;
}
