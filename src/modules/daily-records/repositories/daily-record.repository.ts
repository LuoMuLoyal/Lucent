/**
 * Repository abstraction for UserDailyRecord data access.
 *
 * Decouples business logic in DailyRecordsService from direct PrismaService
 * usage, making queries reusable and testable without mocking the full
 * PrismaClient surface.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type DailyRecordKind } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { nonDeleted } from '../../../common/helpers/prisma.utils';
import {
  dailyRecordWithAttachments,
  type DailyRecordShape,
} from '../types/types';
import type { OwnedRecordSnapshot } from '../services/ownership.service';

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

  abstract transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class DailyRecordRepository implements DailyRecordRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

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
