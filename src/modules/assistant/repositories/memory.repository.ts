/**
 * Repository abstraction for AssistantMemory data access.
 *
 * Encapsulates all Prisma queries for persisted assistant memory rows,
 * decoupling AssistantMemoryService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/index.js';
import { fromPrismaResult } from '../../../common/index.js';
import { okAsync } from '../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

export type AssistantMemoryRow = {
  id: string;
  content: string;
  sourceConversationId: string;
  createdAt: Date;
};

export interface CreateMemoryItem {
  sourceConversationId: string;
  content: string;
}

/**
 * Repository interface for assistant memory data access.
 *
 * Services depend on this interface rather than PrismaService directly,
 * enabling easier unit testing and future data source swaps.
 *
 * Write methods return `ResultAsync<T, DomainFailure>` (known Prisma request
 * errors map to RESOURCE_CONFLICT / RESOURCE_NOT_FOUND; unknown errors
 * re-throw). Read methods keep plain promises: an empty result is a
 * legitimate outcome, not a failure.
 */
export abstract class AssistantMemoryRepositoryPort {
  abstract createMany(
    userId: string,
    items: CreateMemoryItem[],
  ): ResultAsync<number, DomainFailure>;

  abstract findRecent(
    userId: string,
    limit: number,
  ): Promise<AssistantMemoryRow[]>;

  /** Removes all persisted memories for a user (memory-erase entry point). */
  abstract deleteAllForUser(userId: string): ResultAsync<number, DomainFailure>;
}

@Injectable()
export class AssistantMemoryRepository implements AssistantMemoryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  createMany(
    userId: string,
    items: CreateMemoryItem[],
  ): ResultAsync<number, DomainFailure> {
    if (items.length === 0) {
      return okAsync(0);
    }

    return fromPrismaResult(
      this.prisma.assistantMemory
        .createMany({
          data: items.map((item) => ({
            userId,
            sourceConversationId: item.sourceConversationId,
            content: item.content,
          })),
        })
        .then((result) => result.count),
    );
  }

  async findRecent(
    userId: string,
    limit: number,
  ): Promise<AssistantMemoryRow[]> {
    const rows = await this.prisma.assistantMemory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      sourceConversationId: row.sourceConversationId,
      createdAt: row.createdAt,
    }));
  }

  deleteAllForUser(userId: string): ResultAsync<number, DomainFailure> {
    return fromPrismaResult(
      this.prisma.assistantMemory
        .deleteMany({ where: { userId } })
        .then((result) => result.count),
    );
  }
}
