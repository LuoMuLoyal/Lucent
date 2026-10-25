/**
 * Conversation use cases (ADR-0024 `application/use_cases`).
 *
 * Every method is the same three steps — **load -> aggregate behaviour -> save** —
 * and the failure mapping is the only other thing here. The rules live in
 * `domain/conversation/conversation.ts`, persistence behind the port, and the LLM
 * title refinement in this file because it calls a model (an application concern,
 * not a domain one).
 *
 * ## Why the failure mapping is a `switch` over the domain union
 *
 * `ConversationRule` is domain vocabulary; the wire contract is a `DomainFailure`
 * with a registered code (ADR-0012). The translation belongs to this layer, and
 * `switch` means a new rule is a compile error here rather than an unhandled
 * string reaching the client.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import {
  createDomainFailure,
  type DomainFailure,
} from '../../../../common/result/index.js';
import { generatePrefixedId, now } from '../../../../common/index.js';
import { LlmRuntimeService } from '../../../../llm-runtime/index.js';
import { AI_MODEL_TIMEOUT_MS } from '../../../../config/app-defaults.constants.js';
import {
  Conversation,
  buildInitialTitle,
  normalizeRefinedTitle,
  type ConversationRule,
  type ConversationState,
} from '../../domain/conversation/conversation.js';
import {
  normalizeMessages,
  type ConversationMessage,
} from '../../domain/conversation/message.js';
import {
  ASSISTANT_CONVERSATIONS,
  type ConversationRepositoryPort,
  type ConversationSummary,
} from '../../domain/conversation/conversations.js';
import { ASSISTANT_MEMORIES } from '../../domain/memory/memories.js';
import type { MemoryRepositoryPort } from '../../domain/memory/memories.js';
import {
  MAX_MEMORY_ITEMS,
  buildMemoryBlock,
} from '../../domain/memory/memory.js';

/** How many conversations the list endpoint returns. */
export const RECENT_CONVERSATION_LIMIT = 20;

/**
 * The conversation shape the HTTP layer returns.
 *
 * Declared here — it is the use case's output, not the transport's.
 */
export interface ConversationView {
  id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    usedTools: string[];
    createdAt: string;
  }>;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const TITLE_REFINEMENT_SYSTEM_PROMPT = [
  'You are a conversation titler for a personal health assistant.',
  "Write ONE short title (at most 20 characters) that summarizes the user's first message.",
  'Write in Chinese. Output ONLY the title text — no quotes, no punctuation marks, no explanation.',
].join(' ');

const TITLE_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0,
  maxRetries: 0,
} as const;

type Refusal = { ok: false; failure: DomainFailure };
export type Outcome = { ok: true; view: ConversationView } | Refusal;

@Injectable()
export class Conversations {
  private readonly logger = new Logger(Conversations.name);

  constructor(
    @Inject(ASSISTANT_CONVERSATIONS)
    private readonly repository: ConversationRepositoryPort,
    @Inject(ASSISTANT_MEMORIES)
    private readonly memories: MemoryRepositoryPort,
    private readonly llmRuntimeService: LlmRuntimeService,
  ) {}

  // ── reads (read models; never load the aggregate) ─────────────────────

  /** The user's current conversation, or `null` when none is open. */
  async latest(userId: string): Promise<ConversationView | null> {
    const record = await this.repository.findActive(userId);
    return record == null ? null : toView(record);
  }

  /** One conversation of this user; a deleted one counts as missing. */
  async find(
    userId: string,
    conversationId: string,
  ): Promise<ConversationView | null> {
    const record = await this.repository.find(userId, conversationId);
    return record == null ? null : toView(record);
  }

  async listRecent(userId: string): Promise<ConversationSummary[]> {
    return this.repository.listRecent(userId, RECENT_CONVERSATION_LIMIT);
  }

  // ── mutations (load -> rule -> save) ──────────────────────────────────

  /** Rule 2: makes one conversation current, archiving the previous one. */
  async open(userId: string, conversationId: string): Promise<Outcome> {
    const loaded = await this.load(userId, conversationId);
    if (!loaded.ok) return loaded;

    const activated = loaded.conversation.activate();
    if (activated != null) return refuse(activated);

    await this.repository.activate(userId, conversationId);
    const record = await this.repository.find(userId, conversationId);
    if (record == null) return refuse('conversation_not_found');
    return { ok: true, view: toView(record) };
  }

  /** Rule 4: renames a conversation. */
  async rename(
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<Outcome> {
    const loaded = await this.load(userId, conversationId);
    if (!loaded.ok) return loaded;

    const renamed = loaded.conversation.rename(title);
    if (renamed != null) return refuse(renamed);

    const record = await this.repository.save(loaded.conversation);
    return { ok: true, view: toView(record) };
  }

  /** Rule 3: soft delete. A repeated delete is `RESOURCE_NOT_FOUND`. */
  async remove(userId: string, conversationId: string): Promise<Outcome> {
    const loaded = await this.load(userId, conversationId);
    if (!loaded.ok) return loaded;

    const deleted = loaded.conversation.softDelete();
    if (deleted != null) return refuse(deleted);

    const record = await this.repository.save(loaded.conversation);
    return { ok: true, view: toView(record) };
  }

  /**
   * Archives the current conversation (the "clear latest" path).
   *
   * Archiving does **not** touch memory — only `clearMemory` does
   * (`domain/memory/memory.ts` rule 3).
   */
  async archiveLatest(
    userId: string,
  ): Promise<{ archivedConversationId: string | null }> {
    const record = await this.repository.findActive(userId);
    if (record == null) {
      return { archivedConversationId: null };
    }
    const conversation = Conversation.fromState(record);
    conversation.archive();
    await this.repository.save(conversation);
    return { archivedConversationId: record.id };
  }

  /**
   * Rules 1 + 4: persists one streamed turn and returns the stored view.
   *
   * The aggregate assigns the message timestamps (`planTurn`), so the ordering
   * rule survives regardless of what the database default would do.
   */
  async persistTurn(input: {
    userId: string;
    messages: readonly ConversationMessage[];
    assistantContent: string;
    usedTools: readonly string[];
  }): Promise<ConversationView> {
    const normalized = normalizeMessages(input.messages);
    const existing = await this.repository.findActive(input.userId);

    let conversation: Conversation;
    if (existing == null) {
      conversation = Conversation.create({
        id: generatePrefixedId('conversation'),
        userId: input.userId,
        title: buildInitialTitle(normalized),
        createdAt: now(),
      });
      await this.repository.create({
        id: conversation.snapshot().id,
        userId: input.userId,
        title: conversation.snapshot().title,
      });
    } else {
      conversation = Conversation.fromState(existing);
    }

    const planned = conversation.planTurn({
      incoming: normalized,
      assistantContent: input.assistantContent,
      usedTools: input.usedTools,
      assistantAt: now(),
    });
    if ('rule' in planned) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- a runtime anomaly surfaced to the SSE problem mapper unchanged
      throw new Error(
        `Assistant turn was refused by the conversation aggregate (${planned.rule}); ` +
          'the stream path only persists content it actually produced.',
      );
    }

    const stored = await this.repository.appendTurn(planned.turn);

    // Rule 4, refinement half: best-effort LLM title for new conversations only.
    if (existing == null) {
      await this.refineTitle(stored, normalized);
    }

    const reread = await this.repository.find(input.userId, stored.id);
    return toView(reread ?? stored);
  }

  /** Appends the regenerated answer (it becomes the conversation's activity). */
  async appendAssistantMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<ConversationView> {
    const record = await this.repository.find(userId, conversationId);
    if (record == null) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- a runtime anomaly surfaced to the SSE problem mapper unchanged
      throw new Error(
        `Assistant conversation ${conversationId} disappeared before the regenerated answer was stored.`,
      );
    }
    const conversation = Conversation.fromState(record);
    const planned = conversation.planStandaloneAssistantMessage({
      content,
      at: now(),
    });
    if ('rule' in planned) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- a runtime anomaly surfaced to the SSE problem mapper unchanged
      throw new Error(
        `Assistant regeneration produced an unusable answer (${planned.rule}).`,
      );
    }
    const stored = await this.repository.appendAssistantMessage(
      userId,
      conversationId,
      planned.message,
    );
    return toView(stored);
  }

  // ── memory ───────────────────────────────────────────────────────────

  /** The persisted memory block injected into the system prompt. */
  async buildMemoryBlock(userId: string): Promise<string> {
    const items = await this.memories.findRecent(userId, MAX_MEMORY_ITEMS);
    return buildMemoryBlock(items);
  }

  /** Privacy entry point: erases every memory of the user (idempotent). */
  async clearMemory(userId: string): Promise<{ cleared: number }> {
    return { cleared: await this.memories.clearAll(userId) };
  }

  // ── internals ────────────────────────────────────────────────────────

  private async load(
    userId: string,
    conversationId: string,
  ): Promise<{ ok: true; conversation: Conversation } | Refusal> {
    const record = await this.repository.find(userId, conversationId);
    if (record == null) {
      return refuse('conversation_not_found');
    }
    return { ok: true, conversation: Conversation.fromState(record) };
  }

  /**
   * Rule 4, refinement half: asks the chat model for a short title and applies it
   * only while the row still carries the truncation it was asked to refine.
   *
   * Every failure (no model configured, provider error, unusable output) is a
   * silent no-op: the truncated title stays, because a title is not worth failing
   * a user's turn over.
   */
  private async refineTitle(
    record: ConversationState,
    messages: readonly ConversationMessage[],
  ): Promise<void> {
    const firstUserMessage = messages.find((message) => message.role === 'user');
    if (
      firstUserMessage == null ||
      !this.llmRuntimeService.hasRoleConfig('chat')
    ) {
      return;
    }
    try {
      const model = this.llmRuntimeService.createChatModel(
        'chat',
        TITLE_MODEL_OPTIONS,
      );
      const response = await model.invoke([
        { role: 'system', content: TITLE_REFINEMENT_SYSTEM_PROMPT },
        { role: 'user', content: firstUserMessage.content },
      ]);
      const refined = normalizeRefinedTitle(response.content);
      if (refined == null) {
        return;
      }
      const current = await this.repository.find(record.userId, record.id);
      if (current == null) {
        return;
      }
      const conversation = Conversation.fromState(current);
      if (!conversation.applyRefinedTitle(current.title, refined)) {
        return;
      }
      await this.repository.save(conversation);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `Title refinement skipped for conversation ${record.id}: ${cause.message}`,
        cause.stack,
      );
      trace.getActiveSpan()?.addEvent('assistant.title_refinement.failed', {
        conversation_id: record.id,
      });
    }
  }
}

function refuse(rule: ConversationRule): Refusal {
  return { ok: false, failure: toDomainFailure(rule) };
}

/** Maps a domain rule onto the registered failure code (ADR-0012). */
export function toDomainFailure(rule: ConversationRule): DomainFailure {
  switch (rule) {
    case 'conversation_not_found':
    case 'conversation_deleted':
      return createDomainFailure({
        kind: 'not_found',
        code: 'RESOURCE_NOT_FOUND',
        cause: rule,
      });
    case 'title_empty':
    case 'title_too_long':
      return createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
        cause: rule,
      });
    case 'empty_assistant_reply':
      return createDomainFailure({
        kind: 'internal',
        code: 'INTERNAL_ERROR',
        cause: rule,
      });
  }
}

function toView(record: ConversationState): ConversationView {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    messages: record.messages.map((message) => ({
      role: message.role,
      content: message.content,
      usedTools: [...message.usedTools],
      createdAt: message.createdAt.toISOString(),
    })),
    lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
