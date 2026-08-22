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
import { PrismaService } from '../../../prisma';

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
 * Input for recording a message→checkpoint mapping (F-5b regeneration).
 * `sourceMessageId` identifies the assistant message being regenerated and
 * `checkpointId` identifies the LangGraph state from which the replay starts.
 */
export interface RegenerationRecordInput {
  /** Conversation that owns the source message and checkpoint. */
  conversationId: string;
  /** Authenticated user that owns the conversation. */
  userId: string;
  /** Last persisted assistant message selected for regeneration. */
  sourceMessageId: string;
  /** LangGraph checkpoint used as the replay fork point. */
  checkpointId: string;
}

/** Idempotency window for duplicate regenerations of the same message. */
export const REGENERATION_IDEMPOTENCY_WINDOW_MS = 30_000;

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

  abstract softDelete(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages>;

  abstract updateTitle(
    userId: string,
    conversationId: string,
    title: string | null,
  ): Promise<ConversationWithMessages>;

  abstract activateConversation(
    userId: string,
    conversationId: string,
  ): Promise<void>;

  abstract persistTurn(
    input: PersistTurnInput,
  ): Promise<ConversationWithMessages>;

  /**
   * Appends a standalone assistant message (no user messages, no dedup) and
   * bumps `lastMessageAt`. Used by the regeneration path.
   */
  abstract appendAssistantMessage(
    conversationId: string,
    userId: string,
    content: string,
    usedTools?: string[],
  ): Promise<ConversationWithMessages>;

  /** Latest regeneration record for the message within the idempotency window. */
  abstract findRecentRegeneration(
    conversationId: string,
    sourceMessageId: string,
  ): Promise<{ id: string; createdAt: Date } | null>;

  /** Persists the message→checkpoint mapping for a regeneration. */
  abstract createRegeneration(
    input: RegenerationRecordInput,
  ): Promise<{ id: string }>;
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
      where: {
        userId,
        status: { not: AssistantConversationStatus.deleted },
      },
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
      where: {
        id: conversationId,
        userId,
        status: { not: AssistantConversationStatus.deleted },
      },
    });
  }

  async findWithMessagesById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.findFirstOrThrow({
      ...conversationWithMessagesArgs,
      where: {
        id: conversationId,
        userId,
        status: { not: AssistantConversationStatus.deleted },
      },
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

  async softDelete(
    userId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.update({
      ...conversationWithMessagesArgs,
      where: { id: conversationId, userId },
      data: { status: AssistantConversationStatus.deleted },
    });
  }

  async updateTitle(
    userId: string,
    conversationId: string,
    title: string | null,
  ): Promise<ConversationWithMessages> {
    return this.prisma.assistantConversation.update({
      ...conversationWithMessagesArgs,
      where: { id: conversationId, userId },
      data: { title },
    });
  }

  async activateConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
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
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  async persistTurn(
    input: PersistTurnInput,
  ): Promise<ConversationWithMessages> {
    await this.prisma.$transaction(
      async (tx) => {
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
      },
      { maxWait: 5000, timeout: 10000 },
    );

    return this.findWithMessagesById(input.userId, input.conversationId);
  }

  async appendAssistantMessage(
    conversationId: string,
    userId: string,
    content: string,
    usedTools: string[] = [],
  ): Promise<ConversationWithMessages> {
    const timestamp = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        await tx.assistantMessage.create({
          data: {
            conversationId,
            userId,
            role: 'assistant',
            content,
            usedTools,
            createdAt: timestamp,
          },
        });
        await tx.assistantConversation.update({
          where: { id: conversationId, userId },
          data: { lastMessageAt: timestamp },
        });
      },
      { maxWait: 5000, timeout: 10000 },
    );

    return this.findWithMessagesById(userId, conversationId);
  }

  async findRecentRegeneration(
    conversationId: string,
    sourceMessageId: string,
  ): Promise<{ id: string; createdAt: Date } | null> {
    const since = new Date(Date.now() - REGENERATION_IDEMPOTENCY_WINDOW_MS);
    return this.prisma.assistantRegeneration.findFirst({
      where: { conversationId, sourceMessageId, createdAt: { gte: since } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRegeneration(
    input: RegenerationRecordInput,
  ): Promise<{ id: string }> {
    return this.prisma.assistantRegeneration.create({
      data: input,
      select: { id: true },
    });
  }
}
