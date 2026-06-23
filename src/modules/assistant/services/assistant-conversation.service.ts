import { Injectable, NotFoundException } from '@nestjs/common';
import { ResultCode } from '../../../common/api-envelope';
import { AssistantConversationStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AssistantConversationMessage,
  AssistantConversationSnapshot,
  AssistantConversationSummary,
} from '../types/assistant.types';

const conversationInclude = {
  messages: {
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

const conversationSummarySelect = {
  id: true,
  title: true,
  status: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RECENT_CONVERSATION_LIMIT = 20;
const MEMORY_CONVERSATION_LIMIT = 3;
const MEMORY_MESSAGE_LIMIT = 6;

type PersistedMessage = {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  usedTools: unknown;
  createdAt: Date;
};

type PersistedConversation = {
  id: string;
  userId: string;
  title: string | null;
  status: AssistantConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: PersistedMessage[];
};

type PersistedConversationSummary = {
  id: string;
  title: string | null;
  status: AssistantConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AssistantConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation = await this.findLatestActiveConversation(userId);
    return conversation == null ? null : this.toSnapshot(conversation);
  }

  async listRecentConversations(
    userId: string,
  ): Promise<AssistantConversationSummary[]> {
    const conversations = (await this.prisma.assistantConversation.findMany({
      where: { userId },
      select: conversationSummarySelect,
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: RECENT_CONVERSATION_LIMIT,
    })) as PersistedConversationSummary[];

    return conversations.map((conversation) => this.toSummary(conversation));
  }

  async openConversation(
    userId: string,
    conversationId: string,
  ): Promise<AssistantConversationSnapshot> {
    const conversation = (await this.prisma.assistantConversation.findFirst({
      where: { id: conversationId, userId },
      include: conversationInclude,
    })) as PersistedConversation | null;

    if (conversation == null) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Assistant conversation not found',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assistantConversation.updateMany({
        where: {
          userId,
          status: AssistantConversationStatus.active,
          id: { not: conversationId },
        },
        data: { status: AssistantConversationStatus.archived },
      });

      await tx.assistantConversation.update({
        where: { id: conversationId },
        data: { status: AssistantConversationStatus.active },
      });
    });

    const opened = (await this.prisma.assistantConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: conversationInclude,
    })) as PersistedConversation;

    return this.toSnapshot(opened);
  }

  async clearLatestConversation(
    userId: string,
  ): Promise<AssistantConversationSnapshot | null> {
    const conversation = await this.findLatestActiveConversation(userId);
    if (conversation == null) {
      return null;
    }

    const archived = (await this.prisma.assistantConversation.update({
      where: { id: conversation.id },
      data: { status: AssistantConversationStatus.archived },
      include: conversationInclude,
    })) as PersistedConversation;

    return this.toSnapshot(archived);
  }

  async persistAssistantTurn(input: {
    userId: string;
    messages: AssistantConversationMessage[];
    assistantContent: string;
    usedTools: string[];
  }): Promise<AssistantConversationSnapshot> {
    const normalized = this.normalizeMessages(input.messages);
    const activeConversation = await this.findLatestActiveConversation(
      input.userId,
    );

    const conversation =
      activeConversation ??
      (await this.prisma.assistantConversation.create({
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
        await tx.assistantMessage.createMany({
          data: userMessagesToAppend.map((message) => ({
            conversationId: conversation.id,
            userId: input.userId,
            role: message.role,
            content: message.content,
            usedTools: [],
          })),
        });
      }

      await tx.assistantMessage.create({
        data: {
          conversationId: conversation.id,
          userId: input.userId,
          role: 'assistant',
          content: input.assistantContent,
          usedTools: input.usedTools,
          createdAt: assistantNow,
        },
      });

      await tx.assistantConversation.update({
        where: { id: conversation.id },
        data: {
          title: conversation.title ?? this.buildConversationTitle(normalized),
          lastMessageAt: assistantNow,
        },
      });
    });

    const saved = (await this.prisma.assistantConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: conversationInclude,
    })) as PersistedConversation;
    return this.toSnapshot(saved);
  }

  async buildMemoryBlock(userId: string): Promise<string> {
    const conversations = (await this.prisma.assistantConversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: MEMORY_MESSAGE_LIMIT,
        },
      },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: MEMORY_CONVERSATION_LIMIT,
    })) as PersistedConversation[];

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

  private async findLatestActiveConversation(
    userId: string,
  ): Promise<PersistedConversation | null> {
    return this.prisma.assistantConversation.findFirst({
      where: { userId, status: AssistantConversationStatus.active },
      include: conversationInclude,
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
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

    return compact.length <= 48 ? compact : '${compact.substring(0, 48)}...';
  }

  private toSnapshot(
    conversation: PersistedConversation,
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
    conversation: PersistedConversationSummary,
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
