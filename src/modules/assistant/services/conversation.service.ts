import { truncate } from '../../../common';
import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { I18nService } from 'nestjs-i18n';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/constants';
import { LlmRuntimeService } from '../../../llm-runtime';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  unwrapResult,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';

import type {
  AssistantConversationMessage,
  AssistantConversationSnapshot,
  AssistantConversationSummary,
} from '../types/assistant.types';
import { now } from '../../../common';
import {
  MAX_COMPACT_LENGTH,
  RECENT_CONVERSATION_LIMIT,
} from '../tools/shared/tool-constants';
import {
  AssistantConversationRepositoryPort,
  type ConversationWithMessages,
  type ConversationSummary,
} from '../repositories/conversation.repository';
import { AssistantMemoryService } from './memory.service';

/**
 * Best-effort LLM title refinement (F-2): the conversation is created with a
 * synchronous truncated first-message title, then a background chat-model call
 * proposes a short Chinese title. Any failure degrades silently and leaves the
 * initial truncated title in place.
 */
const TITLE_REFINEMENT_SYSTEM_PROMPT = [
  'You are a conversation titler for a personal health assistant.',
  "Write ONE short title (at most 20 characters) that summarizes the user's first message.",
  'Write in Chinese. Output ONLY the title text — no quotes, no punctuation marks, no explanation.',
].join(' ');

/** Maximum length of a refined title (LLM output is clamped to this). */
const TITLE_REFINEMENT_MAX_LENGTH = 20;

const TITLE_MODEL_OPTIONS = {
  timeout: AI_MODEL_TIMEOUT_MS,
  temperature: 0,
  maxRetries: 0,
} as const;

@Injectable()
export class AssistantConversationService {
  private readonly logger = new Logger(AssistantConversationService.name);

  constructor(
    private readonly repository: AssistantConversationRepositoryPort,
    private readonly i18n: I18nService,
    private readonly memoryService: AssistantMemoryService,
    private readonly llmRuntimeService: LlmRuntimeService,
  ) {}

  async getLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation =
      await this.repository.findLatestActiveWithMessages(userId);
    return conversation == null ? null : this.toSnapshot(conversation);
  }

  /**
   * Returns the user's conversation snapshot without activating it, or null
   * when the conversation does not exist / belongs to another user.
   */
  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation = await this.repository.findWithMessages(
      userId,
      conversationId,
    );
    return conversation == null ? null : this.toSnapshot(conversation);
  }

  async listRecentConversations(
    userId: string,
  ): Promise<AssistantConversationSummary[]> {
    const conversations = await this.repository.listRecentSummaries(
      userId,
      RECENT_CONVERSATION_LIMIT,
    );

    return conversations.map((conversation) => this.toSummary(conversation));
  }

  openConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationSnapshot, DomainFailure> {
    return fromPromise(
      this.repository.findWithMessages(userId, conversationId),
      (error) => {
        throw error;
      },
    ).andThen((conversation) => {
      if (conversation == null || conversation.status === 'deleted') {
        return errAsync(this.conversationNotFound());
      }

      return this.repository
        .activateConversation(userId, conversationId)
        .andThen(() =>
          fromPromise(
            this.repository.findWithMessagesById(userId, conversationId),
            (error) => {
              throw error;
            },
          ),
        )
        .map((opened) => this.toSnapshot(opened));
    });
  }

  /**
   * Renames an existing non-deleted conversation. Deleted conversations are
   * treated as missing (RESOURCE_NOT_FOUND) so a soft-deleted conversation can
   * never be surfaced again through this path.
   */
  renameConversation(
    userId: string,
    conversationId: string,
    title: string | null,
  ): ResultAsync<AssistantConversationSnapshot, DomainFailure> {
    return fromPromise(
      this.repository.findWithMessages(userId, conversationId),
      (error) => {
        throw error;
      },
    ).andThen((conversation) => {
      if (conversation == null || conversation.status === 'deleted') {
        return errAsync(this.conversationNotFound());
      }

      return this.repository
        .updateTitle(userId, conversationId, title)
        .map((updated) => this.toSnapshot(updated));
    });
  }

  /**
   * Soft-deletes an existing non-deleted conversation. Deleted conversations
   * are treated as missing (RESOURCE_NOT_FOUND) so repeated deletes stay
   * idempotent from the client's perspective.
   */
  deleteConversation(
    userId: string,
    conversationId: string,
  ): ResultAsync<AssistantConversationSnapshot, DomainFailure> {
    return fromPromise(
      this.repository.findWithMessages(userId, conversationId),
      (error) => {
        throw error;
      },
    ).andThen((conversation) => {
      if (conversation == null || conversation.status === 'deleted') {
        return errAsync(this.conversationNotFound());
      }

      return this.repository
        .softDelete(userId, conversationId)
        .map((deleted) => this.toSnapshot(deleted));
    });
  }

  async clearLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation =
      await this.repository.findLatestActiveWithMessages(userId);
    if (conversation == null) {
      return null;
    }

    const archived = await unwrapResult(
      this.repository.archiveConversation(userId, conversation.id),
    );

    // Schedule debounced memory extraction for the archived conversation.
    // The scheduler itself never throws (best-effort background extraction).
    await this.memoryService.scheduleExtraction(userId, conversation.id);

    return this.toSnapshot(archived);
  }

  async persistAssistantTurn(input: {
    userId: string;
    messages: AssistantConversationMessage[];
    assistantContent: string;
    usedTools: string[];
  }): Promise<AssistantConversationSnapshot> {
    const normalized = this.normalizeMessages(input.messages);
    const activeConversation =
      await this.repository.findLatestActiveWithMessages(input.userId);

    const conversation = await unwrapResult(
      activeConversation != null
        ? okAsync(activeConversation)
        : this.repository.create(
            input.userId,
            this.buildConversationTitle(normalized),
          ),
    );
    const created = activeConversation == null;

    const existingMessages = conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const appendStartIndex = this.findAppendStartIndex(
      existingMessages,
      normalized,
    );
    const userMessagesToAppend = normalized.slice(appendStartIndex);
    const assistantNow = now();

    const saved = await unwrapResult(
      this.repository.persistTurn({
        conversationId: conversation.id,
        userId: input.userId,
        title: conversation.title ?? this.buildConversationTitle(normalized),
        messagesToAppend: userMessagesToAppend,
        assistantContent: input.assistantContent,
        usedTools: input.usedTools,
        assistantTimestamp: assistantNow,
      }),
    );

    // F-2: best-effort LLM title refinement for brand-new conversations. The
    // synchronous truncated title stays until the background call replaces it;
    // failures are swallowed and the initial title remains.
    if (created) {
      const firstUserMessage = this.readFirstUserMessage(normalized);
      if (firstUserMessage != null) {
        void this.enrichTitleWithLlm(
          input.userId,
          conversation.id,
          firstUserMessage,
        );
      }
    }

    return this.toSnapshot(saved);
  }

  /**
   * Appends a standalone assistant message to an existing conversation and
   * bumps its `lastMessageAt`. Used by the regeneration path (F-5b): the new
   * answer is persisted as a fresh message while the old answer stays put.
   */
  async appendAssistantMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<AssistantConversationSnapshot> {
    const saved = await unwrapResult(
      this.repository.appendAssistantMessage(conversationId, userId, content),
    );
    return this.toSnapshot(saved);
  }

  /**
   * Returns the persisted cross-conversation memory block (delegates to
   * AssistantMemoryService). Raw conversation text is never injected into the
   * prompt anymore (F-9); the block contains at most 5 structured memories.
   */
  async buildMemoryBlock(userId: string): Promise<string> {
    return this.memoryService.buildMemoryBlock(userId);
  }

  private normalizeMessages(
    messages: AssistantConversationMessage[],
  ): AssistantConversationMessage[] {
    return messages
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }))
      .filter((message) => message.content.length > 0);
  }

  private findAppendStartIndex(
    existing: Array<{ role: 'user' | 'assistant'; content: string }>,
    incoming: AssistantConversationMessage[],
  ): number {
    let matched = 0;
    while (
      matched < existing.length &&
      matched < incoming.length &&
      this.sameConversationMessage(existing[matched], incoming[matched])
    ) {
      matched += 1;
    }
    return matched;
  }

  private sameConversationMessage(
    existing: { role: 'user' | 'assistant'; content: string } | undefined,
    incoming: AssistantConversationMessage | undefined,
  ): boolean {
    if (existing == null || incoming == null) {
      return false;
    }

    return (
      existing.role === incoming.role && existing.content === incoming.content
    );
  }

  private buildConversationTitle(
    messages: AssistantConversationMessage[],
  ): string | null {
    const firstUserMessage = messages.find(
      (message) => message.role === 'user',
    );
    if (firstUserMessage == null) {
      return null;
    }

    const compact = firstUserMessage.content.replace(/\s+/g, ' ').trim();
    if (compact.length === 0) {
      return null;
    }

    return truncate(compact, MAX_COMPACT_LENGTH);
  }

  private readFirstUserMessage(
    messages: AssistantConversationMessage[],
  ): string | null {
    const first = messages.find((message) => message.role === 'user');
    return first == null ? null : first.content;
  }

  /**
   * Fire-and-forget LLM title refinement for a newly created conversation
   * (F-2). Never throws: unconfigured model, LLM failure, unparsable output or
   * a user-renamed title all resolve to a silent no-op that keeps the initial
   * truncated title. Only replaces the title while it still equals the initial
   * truncation, so a title the user manually renamed is never overwritten.
   */
  private async enrichTitleWithLlm(
    userId: string,
    conversationId: string,
    firstUserMessage: string,
  ): Promise<void> {
    try {
      const current = await this.repository.findWithMessages(
        userId,
        conversationId,
      );
      const initialTitle = this.buildConversationTitle([
        { role: 'user', content: firstUserMessage },
      ]);
      if (current == null || current.title !== initialTitle) {
        return;
      }

      if (!this.llmRuntimeService.hasRoleConfig('chat')) {
        return;
      }

      const model = this.llmRuntimeService.createChatModel(
        'chat',
        TITLE_MODEL_OPTIONS,
      );
      const response = await model.invoke([
        new SystemMessage(TITLE_REFINEMENT_SYSTEM_PROMPT),
        new HumanMessage(firstUserMessage),
      ]);
      const refined = this.parseRefinedTitle(response.content);
      if (refined == null) {
        return;
      }

      await this.repository.updateTitle(userId, conversationId, refined);
    } catch (error) {
      // Best-effort: title refinement must never break the persistence flow.
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `Title refinement skipped for conversation ${conversationId}: ${cause.message}`,
        cause.stack,
      );
      trace.getActiveSpan()?.addEvent('assistant.title_refinement.failed', {
        conversation_id: conversationId,
      });
    }
  }

  /**
   * Parses the model's title output. Strips surrounding quotes/backticks,
   * collapses whitespace, and clamps to TITLE_REFINEMENT_MAX_LENGTH. Returns
   * null when nothing usable remains (silent degradation).
   */
  private parseRefinedTitle(content: unknown): string | null {
    if (typeof content !== 'string') {
      return null;
    }
    let title = content.trim().replace(/^[`"“”']+|[`"“”']+$/g, '');
    title = title.replace(/\s+/g, ' ').trim();
    if (title.length === 0) {
      return null;
    }
    return title.length > TITLE_REFINEMENT_MAX_LENGTH
      ? title.slice(0, TITLE_REFINEMENT_MAX_LENGTH)
      : title;
  }

  /**
   * Domain failure for a missing or soft-deleted conversation. The detail is
   * localized through the request-scoped i18n context, mirroring the previous
   * 404 message.
   */
  private conversationNotFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
      detail: this.i18n.t('assistant.conversation_not_found'),
    });
  }

  private toSnapshot(
    conversation: ConversationWithMessages,
  ): AssistantConversationSnapshot {
    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      messages: conversation.messages.map((message) => ({
        role: message.role,
        content: message.content,
        usedTools: this.readUsedTools(message.usedTools),
        createdAt: message.createdAt.toISOString(),
      })),
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toSummary(
    conversation: ConversationSummary,
  ): AssistantConversationSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private readUsedTools(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((tool): tool is string => typeof tool === 'string');
  }
}
