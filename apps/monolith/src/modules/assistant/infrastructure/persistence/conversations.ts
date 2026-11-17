/**
 * Prisma implementation of `ConversationRepositoryPort`
 * (`domain/conversation/conversations.ts`, ADR-0024 §4).
 *
 * ## What moved out of the old `repositories/conversation.repository.ts`
 *
 * - The **Result plumbing is gone**. The old port returned
 *   `ResultAsync<T, DomainFailure>` from every write and the application layer
 *   unwrapped it. The aggregate now decides what is legal *before* anything is
 *   written, so the only failures left are "the row is gone" and "the database
 *   refused" — exceptions, which belong to the transport boundary.
 * - The **message ordering is not decided here**. `planTurn` hands over
 *   timestamps that already strictly increase and this file writes them
 *   verbatim; two places assigning `createdAt` is how the ordering drifted in the
 *   first place.
 *
 * Everything else — the `createdAt asc` include, the soft-delete predicate, the
 * activation transaction, the regeneration idempotency window — is preserved
 * behaviour.
 */

import { Injectable } from '@nestjs/common';
import {
  AssistantConversationStatus,
  type Prisma,
} from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  orderMessages,
  type AppendedMessage,
  type Conversation,
  type ConversationState,
  type ConversationTurn,
  type StoredConversationMessage,
} from '../../domain/conversation/conversation.js';
import { readUsedTools } from '../../domain/conversation/message.js';
import {
  REGENERATION_IDEMPOTENCY_WINDOW_MS,
  type ConversationRepositoryPort,
  type ConversationSummary,
} from '../../domain/conversation/conversations.js';

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

type ConversationRow = Prisma.AssistantConversationGetPayload<
  typeof conversationWithMessagesArgs
>;

const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 10000 } as const;

function toStoredMessage(row: {
  id: string;
  role: string;
  content: string;
  usedTools: unknown;
  createdAt: Date;
}): StoredConversationMessage {
  return {
    id: row.id,
    // The column is an enum on the database side; anything else is rejected on
    // write, so this narrowing states a fact rather than guessing one.
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    usedTools: readUsedTools(row.usedTools),
    createdAt: row.createdAt,
  };
}

function toState(row: ConversationRow): ConversationState {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    // Repairs rows written before the ordering rule existed.
    messages: orderMessages(row.messages.map(toStoredMessage)),
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaConversations implements ConversationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    userId: string,
    conversationId: string,
  ): Promise<ConversationState | null> {
    const row = await this.prisma.assistantConversation.findFirst({
      ...conversationWithMessagesArgs,
      where: {
        id: conversationId,
        userId,
        status: { not: AssistantConversationStatus.deleted },
      },
    });
    return row == null ? null : toState(row);
  }

  async findActive(userId: string): Promise<ConversationState | null> {
    const row = await this.prisma.assistantConversation.findFirst({
      ...conversationWithMessagesArgs,
      where: { userId, status: AssistantConversationStatus.active },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });
    return row == null ? null : toState(row);
  }

  async create(input: {
    id: string;
    userId: string;
    title: string | null;
  }): Promise<ConversationState> {
    const row = await this.prisma.assistantConversation.create({
      ...conversationWithMessagesArgs,
      data: { id: input.id, userId: input.userId, title: input.title },
    });
    return toState(row);
  }

  async save(conversation: Conversation): Promise<ConversationState> {
    const state = conversation.snapshot();
    const row = await this.prisma.assistantConversation.update({
      ...conversationWithMessagesArgs,
      where: { id: state.id, userId: state.userId },
      data: {
        title: state.title,
        status: state.status,
        ...(state.lastMessageAt != null
          ? { lastMessageAt: state.lastMessageAt }
          : {}),
      },
    });
    return toState(row);
  }

  async activate(userId: string, conversationId: string): Promise<void> {
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
    }, TRANSACTION_OPTIONS);
  }

  async appendTurn(turn: ConversationTurn): Promise<ConversationState> {
    await this.prisma.$transaction(async (tx) => {
      // One insert per message, in order: the aggregate assigned the timestamps,
      // and they must be written verbatim for the ordering rule to hold.
      for (const message of turn.messages) {
        await tx.assistantMessage.create({
          data: {
            conversationId: turn.conversationId,
            userId: turn.userId,
            role: message.role,
            content: message.content,
            usedTools: [...message.usedTools],
            createdAt: message.createdAt,
          },
        });
      }
      await tx.assistantConversation.update({
        where: { id: turn.conversationId, userId: turn.userId },
        data: { title: turn.title, lastMessageAt: turn.assistantAt },
      });
    }, TRANSACTION_OPTIONS);

    return this.requireById(turn.userId, turn.conversationId);
  }

  async appendAssistantMessage(
    userId: string,
    conversationId: string,
    message: AppendedMessage,
  ): Promise<ConversationState> {
    await this.prisma.$transaction(async (tx) => {
      await tx.assistantMessage.create({
        data: {
          conversationId,
          userId,
          role: message.role,
          content: message.content,
          usedTools: [...message.usedTools],
          createdAt: message.createdAt,
        },
      });
      await tx.assistantConversation.update({
        where: { id: conversationId, userId },
        data: { lastMessageAt: message.createdAt },
      });
    }, TRANSACTION_OPTIONS);

    return this.requireById(userId, conversationId);
  }

  async listRecent(
    userId: string,
    limit: number,
  ): Promise<ConversationSummary[]> {
    const rows = await this.prisma.assistantConversation.findMany({
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
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
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

  async createRegeneration(input: {
    conversationId: string;
    userId: string;
    sourceMessageId: string;
    checkpointId: string;
  }): Promise<{ id: string }> {
    return this.prisma.assistantRegeneration.create({
      data: input,
      select: { id: true },
    });
  }

  private async requireById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationState> {
    const state = await this.find(userId, conversationId);
    if (state == null) {
      // eslint-disable-next-line error-handling/no-bare-throw-error -- a runtime anomaly surfaced to the SSE problem mapper unchanged
      throw new Error(
        `Assistant conversation ${conversationId} disappeared after it was written.`,
      );
    }
    return state;
  }
}
