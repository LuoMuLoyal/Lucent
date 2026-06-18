import { Injectable } from '@nestjs/common';
import {
  AiChatConversationStatus,
  type Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AiChatConversationMessage,
  AiChatConversationSnapshot,
} from './ai-chat.types';

const conversationInclude = {
  messages: {
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

type PersistedConversation = Prisma.AiChatConversationGetPayload<{
  include: typeof conversationInclude;
}>;

@Injectable()
export class AiChatConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestConversation(
    userId: string,
  ): Promise<AiChatConversationSnapshot | null> {
    const conversation = await this.findLatestActiveConversation(userId);
    return conversation == null ? null : this.toSnapshot(conversation);
  }

  async clearLatestConversation(
    userId: string,
  ): Promise<AiChatConversationSnapshot | null> {
    const conversation = await this.findLatestActiveConversation(userId);
    if (conversation == null) {
      return null;
    }

    const archived = await this.prisma.aiChatConversation.update({
      where: { id: conversation.id },
      data: { status: AiChatConversationStatus.archived },
      include: conversationInclude,
    });

    return this.toSnapshot(archived);
  }

  async persistAssistantTurn(input: {
    userId: string;
    messages: AiChatConversationMessage[];
    assistantContent: string;
    usedTools: string[];
  }): Promise<AiChatConversationSnapshot> {
    const normalized = this.normalizeMessages(input.messages);
    const activeConversation = await this.findLatestActiveConversation(
      input.userId,
    );

    const conversation =
      activeConversation ??
      (await this.prisma.aiChatConversation.create({
        data: {
          userId: input.userId,
          title: this.buildConversationTitle(normalized),
        },
        include: conversationInclude,
      }));

    const existingMessages = conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const appendStartIndex = this.findAppendStartIndex(
      existingMessages,
      normalized,
    );
    const userMessagesToAppend = normalized.slice(appendStartIndex);
    const assistantNow = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (userMessagesToAppend.length > 0) {
        await tx.aiChatMessage.createMany({
          data: userMessagesToAppend.map((message) => ({
            conversationId: conversation.id,
            userId: input.userId,
            role: message.role,
            content: message.content,
            usedTools: [],
          })),
        });
      }

      await tx.aiChatMessage.create({
        data: {
          conversationId: conversation.id,
          userId: input.userId,
          role: 'assistant',
          content: input.assistantContent,
          usedTools: input.usedTools,
          createdAt: assistantNow,
        },
      });

      await tx.aiChatConversation.update({
        where: { id: conversation.id },
        data: {
          title: conversation.title ?? this.buildConversationTitle(normalized),
          lastMessageAt: assistantNow,
        },
      });
    });

    const saved = await this.prisma.aiChatConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: conversationInclude,
    });
    return this.toSnapshot(saved);
  }

  private async findLatestActiveConversation(
    userId: string,
  ): Promise<PersistedConversation | null> {
    return this.prisma.aiChatConversation.findFirst({
      where: { userId, status: AiChatConversationStatus.active },
      include: conversationInclude,
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  private normalizeMessages(
    messages: AiChatConversationMessage[],
  ): AiChatConversationMessage[] {
    return messages
      .map((message) => ({
        role: message.role,
        content: message.content.trim(),
      }))
      .filter((message) => message.content.length > 0);
  }

  private findAppendStartIndex(
    existing: Array<{ role: 'user' | 'assistant'; content: string }>,
    incoming: AiChatConversationMessage[],
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
    incoming: AiChatConversationMessage | undefined,
  ): boolean {
    if (existing == null || incoming == null) {
      return false;
    }

    return (
      existing.role === incoming.role && existing.content === incoming.content
    );
  }

  private buildConversationTitle(
    messages: AiChatConversationMessage[],
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

    return compact.length <= 48 ? compact : '${compact.substring(0, 48)}...';
  }

  private toSnapshot(
    conversation: PersistedConversation,
  ): AiChatConversationSnapshot {
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

  private readUsedTools(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.filter((tool): tool is string => typeof tool === 'string');
  }
}
