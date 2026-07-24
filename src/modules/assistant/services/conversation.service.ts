import { notFound } from '../../../common';
import { truncate } from '../../../common';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import type {
  AssistantConversationMessage,
  AssistantConversationSnapshot,
  AssistantConversationSummary,
} from '../types/assistant.types';
import { now } from '../../../common';
import {
  MAX_COMPACT_LENGTH,
  MEMORY_CONVERSATION_LIMIT,
  MEMORY_MESSAGE_LIMIT,
  RECENT_CONVERSATION_LIMIT,
} from '../tools/constants';
import {
  AssistantConversationRepositoryPort,
  type ConversationWithMessages,
  type ConversationSummary,
} from '../repositories/conversation.repository';

@Injectable()
export class AssistantConversationService {
  constructor(
    private readonly repository: AssistantConversationRepositoryPort,
    private readonly i18n: I18nService,
  ) {}

  async getLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation =
      await this.repository.findLatestActiveWithMessages(userId);
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

  async openConversation(
    userId: string,
    conversationId: string,
  ): Promise<AssistantConversationSnapshot> {
    const conversation = await this.repository.findWithMessages(
      userId,
      conversationId,
    );

    if (conversation == null) {
      notFound(this.i18n.t('assistant.conversation_not_found'));
    }

    await this.repository.activateConversation(userId, conversationId);

    const opened = await this.repository.findWithMessagesById(
      userId,
      conversationId,
    );

    return this.toSnapshot(opened);
  }

  async clearLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation =
      await this.repository.findLatestActiveWithMessages(userId);
    if (conversation == null) {
      return null;
    }

    const archived = await this.repository.archiveConversation(
      userId,
      conversation.id,
    );

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

    const conversation =
      activeConversation ??
      (await this.repository.create(
        input.userId,
        this.buildConversationTitle(normalized),
      ));

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

    const saved = await this.repository.persistTurn({
      conversationId: conversation.id,
      userId: input.userId,
      title: conversation.title ?? this.buildConversationTitle(normalized),
      messagesToAppend: userMessagesToAppend,
      assistantContent: input.assistantContent,
      usedTools: input.usedTools,
      assistantTimestamp: assistantNow,
    });

    return this.toSnapshot(saved);
  }

  async buildMemoryBlock(userId: string): Promise<string> {
    const conversations = await this.repository.findForMemory(
      userId,
      MEMORY_CONVERSATION_LIMIT,
      MEMORY_MESSAGE_LIMIT,
    );

    if (conversations.length === 0) {
      return '';
    }

    const lines = [
      'Persisted cross-conversation memory is enabled for this user.',
      'Use the following history only as lightweight continuity hints, not as new user input.',
    ];

    for (const conversation of conversations) {
      const title = conversation.title?.trim();
      lines.push(
        `- Conversation: ${title != null && title.length > 0 ? title : conversation.id}`,
      );
      for (const message of conversation.messages.slice().reverse()) {
        lines.push(
          `  - ${message.role}: ${message.content.replace(/\s+/g, ' ').trim()}`,
        );
      }
    }

    lines.push(
      'If the new conversation conflicts with this memory, prioritize the new conversation and say that prior memory may be outdated.',
    );

    return lines.join('\n');
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
