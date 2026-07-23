/**
 * Repository abstraction for UserDailyRecord data access.
 *
 * Decouples business logic in DailyRecordsService from direct PrismaService
 * usage, making queries reusable and testable without mocking the full
 * PrismaClient surface.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type DailyRecordKind } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { nonDeleted } from '../../../common/helpers';
import {
  dailyRecordWithAttachments,
  type DailyRecordShape,
  type OwnedRecordSnapshot,
} from '../types';

/** Query filters for listing daily records. */
export interface DailyRecordListFilter {
  userId: string;
  occurredAt: Date;
  kind?: DailyRecordKind;
}

/** Pagination parameters. */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** Result of a paginated query. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

/**
 * Lean read-model shape for cross-module consumers (ADR-0009). Exposes
 * record fields only — no Prisma query DSL. Canonical order is
 * `occurredAt asc, createdAt asc`; consumers needing another order
 * re-sort in memory.
 */
export interface DailyRecordFact {
  id: string;
  kind: DailyRecordKind;
  occurredAt: Date;
  occurredTime: string | null;
  title: string | null;
  value: string | null;
  unit: string | null;
  note: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}

/**
 * Hard upper bound on facts returned by reader ports. Prevents unbounded
 * context queries from slowing the AI pipeline as user data grows.
 * (ADR-0009 reader ports; architecture review #15)
 */
const MAX_READER_FACTS = 500;

const dailyRecordFactSelect = {
  id: true,
  kind: true,
  occurredAt: true,
  occurredTime: true,
  title: true,
  value: true,
  unit: true,
  note: true,
  payload: true,
  createdAt: true,
} satisfies Prisma.UserDailyRecordSelect;

/**
 * Read-only port for cross-module reads of UserDailyRecord (ADR-0009).
 * Implemented by DailyRecordRepository and exported from DailyRecordsModule;
 * write paths stay behind DailyRecordsService / DailyRecordRepositoryPort.
 */
export abstract class DailyRecordReaderPort {
  /** Lists non-deleted records with `occurredAt` in [from, to] (inclusive). */
  abstract listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<DailyRecordFact[]>;
}

/**
 * Repository interface for daily record data access.
 *
 * Services depend on this interface rather than PrismaService directly,
 * enabling easier unit testing and future data source swaps.
 */
export abstract class DailyRecordRepositoryPort {
  abstract findManyWithAttachments(
    filter: DailyRecordListFilter,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<DailyRecordShape>>;

  abstract findByIdWithAttachments(
    userId: string,
    id: string,
  ): Promise<DailyRecordShape | null>;

  /** Fetch only the ownership-relevant fields (userId, kind, payload). */
  abstract findOwnershipData(
    id: string,
  ): Promise<(OwnedRecordSnapshot & { userId: string }) | null>;

  abstract findManyByDateWithAttachments(
    userId: string,
    occurredAt: Date,
  ): Promise<DailyRecordShape[]>;

  abstract create(
    data: Prisma.UserDailyRecordUncheckedCreateInput,
  ): Promise<DailyRecordShape>;

  abstract update(
    id: string,
    data: Prisma.UserDailyRecordUpdateInput,
  ): Promise<DailyRecordShape>;

  abstract softDelete(id: string, deletedAt: Date): Promise<void>;

  /**
   * Executes a Prisma transaction.
   *
   * WARNING: The callback MUST NOT call any method that internally uses
   * `$transaction` (e.g. `MealDishTemplateLearningService.learnFromConfirmedAnalysis`).
   * Prisma nested transactions silently degrade to independent connections,
   * losing atomicity. Side effects (queue enqueue, cache invalidation, etc.)
   * must also be moved outside the callback — only DB writes that need
   * atomicity belong here.
   */
  abstract transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class DailyRecordRepository
  implements DailyRecordRepositoryPort, DailyRecordReaderPort
{
  constructor(private readonly prisma: PrismaService) {}

  async listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<DailyRecordFact[]> {
    return this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        ...nonDeleted,
        occurredAt: { gte: from, lte: to },
        ...(kinds != null && kinds.length > 0 ? { kind: { in: kinds } } : {}),
      },
      select: dailyRecordFactSelect,
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      take: MAX_READER_FACTS,
    });
  }

  async findManyWithAttachments(
    filter: DailyRecordListFilter,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<DailyRecordShape>> {
    const where: Prisma.UserDailyRecordWhereInput = {
      userId: filter.userId,
      occurredAt: filter.occurredAt,
      ...nonDeleted,
      ...(filter.kind != null ? { kind: filter.kind } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.userDailyRecord.findMany({
        where,
        include: dailyRecordWithAttachments,
        orderBy: [
          { occurredTime: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.userDailyRecord.count({ where }),
    ]);

    return { items, total };
  }

  async findByIdWithAttachments(
    userId: string,
    id: string,
  ): Promise<DailyRecordShape | null> {
    return this.prisma.userDailyRecord.findFirst({
      where: { id, userId, deletedAt: null },
      include: dailyRecordWithAttachments,
    });
  }

  async findOwnershipData(
    id: string,
  ): Promise<(OwnedRecordSnapshot & { userId: string }) | null> {
    return this.prisma.userDailyRecord.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, kind: true, payload: true, occurredAt: true },
    });
  }

  async findManyByDateWithAttachments(
    userId: string,
    occurredAt: Date,
  ): Promise<DailyRecordShape[]> {
    return this.prisma.userDailyRecord.findMany({
      where: { userId, occurredAt, ...nonDeleted },
      include: dailyRecordWithAttachments,
      orderBy: [
        { occurredTime: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
  }

  async create(
    data: Prisma.UserDailyRecordUncheckedCreateInput,
  ): Promise<DailyRecordShape> {
    return this.prisma.userDailyRecord.create({
      data,
      include: dailyRecordWithAttachments,
    });
  }

  async update(
    id: string,
    data: Prisma.UserDailyRecordUpdateInput,
  ): Promise<DailyRecordShape> {
    return this.prisma.userDailyRecord.update({
      where: { id },
      data,
      include: dailyRecordWithAttachments,
    });
  }

  async softDelete(id: string, deletedAt: Date): Promise<void> {
    await this.prisma.userDailyRecord.update({
      where: { id },
      data: { deletedAt },
    });
  }

  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
