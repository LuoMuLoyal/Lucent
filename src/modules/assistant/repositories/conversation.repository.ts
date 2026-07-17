/**
 * Repository abstraction for AssistantConversation and AssistantMessage data access.
 *
 * Encapsulates all Prisma queries for conversation persistence, including
 * transactional operations like opening and persisting turns.
 */
import { Injectable } from '@nestjs/common';
import {
  AssistantConversationStatus,
  type Prisma,
} from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

const conversationWithMessagesArgs = {
  include: {
    messages: {
      orderBy: { createdAt: 'asc' as const },
    },
  },
} satisfies Prisma.AssistantConversationDefaultArgs;

const conversationSummaryArgs = {
  select: {
    id: true,
    title: true,
    status: true,
    lastMessageAt: true,
    createdAt: true,
    updatedAt: true,
  },
} satisfies Prisma.AssistantConversationDefaultArgs;

export type ConversationWithMessages = Prisma.AssistantConversationGetPayload<
  typeof conversationWithMessagesArgs
>;

export type ConversationSummary = Prisma.AssistantConversationGetPayload<
  typeof conversationSummaryArgs
>;

export interface PersistTurnInput {
  conversationId: string;
  userId: string;
  title: string | null;
  messagesToAppend: Array<{ role: 'user' | 'assistant'; content: string }>;
  assistantContent: string;
  usedTools: string[];
  assistantTimestamp: Date;
}

/**
 * Repository interface for assistant conversation data access.
 *
 * Services depend on this interface rather than PrismaService directly,
 * enabling easier unit testing and future data source swaps.
 */
export abstract class AssistantConversationRepositoryPort {
  abstract findLatestActiveWithMessages(
    userId: string,
  ): Promise<ConversationWithMessages | null>;

  abstract listRecentSummaries(
    userId: string,
    limit: number,
  ): Promise<ConversationSummary[]>;

  abstract findWithMessages(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages | null>;

  abstract findWithMessagesById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages>;

  abstract create(
    userId: string,
    title: string | null,
  ): Promise<ConversationWithMessages>;

  abstract archiveConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages>;

  abstract activateConversation(
    userId: string,
    conversationId: string,
  ): Promise<void>;

  abstract persistTurn(
    input: PersistTurnInput,
  ): Promise<ConversationWithMessages>;

  abstract findForMemory(
    userId: string,
    conversationLimit: number,
    messageLimit: number,
  ): Promise<ConversationWithMessages[]>;
}

@Injectable()
export class AssistantConversationRepository implements AssistantConversationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestActiveWithMessages(
    userId: string,
  ): Promise<ConversationWithMessages | null> {
    return this.prisma.assistantConversation.findFirst({
      ...conversationWithMessagesArgs,
      where: { userId, status: AssistantConversationStatus.active },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async listRecentSummaries(
    userId: string,
    limit: number,
  ): Promise<ConversationSummary[]> {
    return this.prisma.assistantConversation.findMany({
      ...conversationSummaryArgs,
      where: { userId },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    });
  }

  async findWithMessages(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages | null> {
    return this.prisma.assistantConversation.findFirst({
      ...conversationWithMessagesArgs,
      where: { id: conversationId, userId },
    });
  }

  async findWithMessagesById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.findFirstOrThrow({
      ...conversationWithMessagesArgs,
      where: { id: conversationId, userId },
    });
  }

  async create(
    userId: string,
    title: string | null,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.create({
      ...conversationWithMessagesArgs,
      data: { userId, title },
    });
  }

  async archiveConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.update({
      ...conversationWithMessagesArgs,
      where: { id: conversationId, userId },
      data: { status: AssistantConversationStatus.archived },
    });
  }

  async activateConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
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
        where: { id: conversationId, userId },
        data: { status: AssistantConversationStatus.active },
      });
    });
  }

  async persistTurn(
    input: PersistTurnInput,
  ): Promise<ConversationWithMessages> {
    await this.prisma.$transaction(async (tx) => {
      if (input.messagesToAppend.length > 0) {
        await tx.assistantMessage.createMany({
          data: input.messagesToAppend.map((message) => ({
            conversationId: input.conversationId,
            userId: input.userId,
            role: message.role,
            content: message.content,
            usedTools: [],
          })),
        });
      }

      await tx.assistantMessage.create({
        data: {
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'assistant',
          content: input.assistantContent,
          usedTools: input.usedTools,
          createdAt: input.assistantTimestamp,
        },
      });

      await tx.assistantConversation.update({
        where: { id: input.conversationId, userId: input.userId },
        data: {
          title: input.title,
          lastMessageAt: input.assistantTimestamp,
        },
      });
    });

    return this.findWithMessagesById(input.userId, input.conversationId);
  }

  async findForMemory(
    userId: string,
    conversationLimit: number,
    messageLimit: number,
  ): Promise<ConversationWithMessages[]> {
    return this.prisma.assistantConversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: messageLimit,
        },
      },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: conversationLimit,
    });
  }
}
