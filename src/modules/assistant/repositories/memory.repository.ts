/**
 * Repository abstraction for AssistantMemory data access.
 *
 * Encapsulates all Prisma queries for persisted assistant memory rows,
 * decoupling AssistantMemoryService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma';

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
 */
export abstract class AssistantMemoryRepositoryPort {
  abstract createMany(
    userId: string,
    items: CreateMemoryItem[],
  ): Promise<number>;

  abstract findRecent(
    userId: string,
    limit: number,
  ): Promise<AssistantMemoryRow[]>;

  /** Removes all persisted memories for a user (memory-erase entry point). */
  abstract deleteAllForUser(userId: string): Promise<number>;
}

@Injectable()
export class AssistantMemoryRepository implements AssistantMemoryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(userId: string, items: CreateMemoryItem[]): Promise<number> {
    if (items.length === 0) {
      return 0;
    }

    const result = await this.prisma.assistantMemory.createMany({
      data: items.map((item) => ({
        userId,
        sourceConversationId: item.sourceConversationId,
        content: item.content,
      })),
    });

    return result.count;
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

  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.assistantMemory.deleteMany({
      where: { userId },
    });

    return result.count;
  }
}
