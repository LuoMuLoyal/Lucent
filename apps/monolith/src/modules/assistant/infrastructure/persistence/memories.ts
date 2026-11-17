/**
 * Prisma implementation of `MemoryRepositoryPort`
 * (`domain/memory/memories.ts`, ADR-0024 §4).
 *
 * Deliberately thin: every rule (which statements are durable, the prompt cap,
 * the block rendering) lives in the aggregate. This class only maps rows.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import type {
  MemoryItem,
  NewMemoryItem,
  MemoryRepositoryPort,
} from '../../domain/memory/memories.js';

@Injectable()
export class PrismaMemories implements MemoryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, items: readonly NewMemoryItem[]): Promise<number> {
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

  async findRecent(userId: string, limit: number): Promise<MemoryItem[]> {
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

  async clearAll(userId: string): Promise<number> {
    const result = await this.prisma.assistantMemory.deleteMany({
      where: { userId },
    });
    return result.count;
  }
}
