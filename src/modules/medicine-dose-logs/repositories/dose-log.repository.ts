import { Injectable } from '@nestjs/common';
import { Prisma, type DoseLogStatus } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import { fromPrismaResult, nonDeleted } from '../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';

/**
 * Lean read-model shape for cross-module consumers (ADR-0009). Exposes
 * dose-log fields only — no Prisma query DSL. Canonical order is
 * `scheduledFor asc`.
 */
export interface DoseLogFact {
  currentMedicineId: string | null;
  reminderId: string | null;
  status: DoseLogStatus;
  scheduledTime: string | null;
  scheduledFor: Date;
}

/**
 * Hard upper bound on facts returned by reader ports. Prevents unbounded
 * context queries from slowing the AI pipeline as user data grows.
 * (ADR-0009 reader ports; architecture review #15)
 */
const MAX_READER_FACTS = 500;

const doseLogFactSelect = {
  currentMedicineId: true,
  reminderId: true,
  status: true,
  scheduledTime: true,
  scheduledFor: true,
} satisfies Prisma.UserMedicineDoseLogSelect;

/**
 * Read-only port for cross-module reads of UserMedicineDoseLog (ADR-0009).
 * Implemented by MedicineDoseLogRepository and exported from
 * MedicineDoseLogsModule; write paths stay behind MedicineDoseLogsService /
 * MedicineDoseLogRepositoryPort.
 */
export abstract class MedicineDoseLogReaderPort {
  /**
   * Lists non-deleted dose logs with `scheduledFor` in [from, to]
   * (inclusive). Capped at MAX_READER_FACTS — use
   * {@link countFactsInRange} / {@link findLatestScheduledForInRange} for
   * exact totals and timestamps.
   */
  abstract listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<DoseLogFact[]>;

  /** Exact count of non-deleted dose logs with `scheduledFor` in [from, to]. */
  abstract countFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<number>;

  /**
   * Latest `scheduledFor` among non-deleted dose logs in [from, to], or null
   * when none exists.
   */
  abstract findLatestScheduledForInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Date | null>;
}

/**
 * Abstract port for medicine dose-log data access.
 *
 * Allows `MedicineDoseLogsService` to depend on an interface rather than
 * `PrismaService` directly, simplifying unit testing and future data-source
 * swaps.
 */
export abstract class MedicineDoseLogRepositoryPort {
  abstract findMany(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
  ): Promise<Prisma.UserMedicineDoseLogGetPayload<object>[]>;

  abstract findManyWithCount(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
    pagination: { page: number; pageSize: number },
  ): Promise<{
    items: Prisma.UserMedicineDoseLogGetPayload<object>[];
    total: number;
  }>;

  abstract findFirst(
    where: Prisma.UserMedicineDoseLogWhereInput,
    options?: {
      select?: Prisma.UserMedicineDoseLogSelect;
      orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[];
    },
  ): Promise<unknown>;

  abstract create(
    data: Prisma.UserMedicineDoseLogUncheckedCreateInput,
  ): ResultAsync<Prisma.UserMedicineDoseLogGetPayload<object>, DomainFailure>;

  abstract update(
    where: Prisma.UserMedicineDoseLogWhereUniqueInput,
    data:
      | Prisma.UserMedicineDoseLogUpdateInput
      | Prisma.UserMedicineDoseLogUncheckedUpdateInput,
  ): ResultAsync<Prisma.UserMedicineDoseLogGetPayload<object>, DomainFailure>;

  abstract findReminderById(
    userId: string,
    id: string,
  ): Promise<{
    userId: string;
    currentMedicineId: string | null;
    scheduledHour: number;
    scheduledMinute: number;
  } | null>;

  abstract findCurrentMedicineById(
    userId: string,
    id: string,
  ): Promise<{ userId: string } | null>;
}

@Injectable()
export class MedicineDoseLogRepository
  extends MedicineDoseLogRepositoryPort
  implements MedicineDoseLogReaderPort
{
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<DoseLogFact[]> {
    return this.prisma.userMedicineDoseLog.findMany({
      where: {
        userId,
        ...nonDeleted,
        scheduledFor: { gte: from, lte: to },
      },
      select: doseLogFactSelect,
      orderBy: [{ scheduledFor: 'asc' }],
      take: MAX_READER_FACTS,
    });
  }

  async countFactsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.userMedicineDoseLog.count({
      where: {
        userId,
        ...nonDeleted,
        scheduledFor: { gte: from, lte: to },
      },
    });
  }

  async findLatestScheduledForInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Date | null> {
    const row = await this.prisma.userMedicineDoseLog.findFirst({
      where: {
        userId,
        ...nonDeleted,
        scheduledFor: { gte: from, lte: to },
      },
      select: { scheduledFor: true },
      orderBy: [{ scheduledFor: 'desc' }],
    });
    return row?.scheduledFor ?? null;
  }

  override findMany(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
  ) {
    const args: Parameters<
      PrismaService['userMedicineDoseLog']['findMany']
    >[0] = { where };
    if (orderBy !== undefined) args.orderBy = orderBy;
    return this.prisma.userMedicineDoseLog.findMany(args);
  }

  override async findManyWithCount(
    where: Prisma.UserMedicineDoseLogWhereInput,
    orderBy: Prisma.UserMedicineDoseLogOrderByWithRelationInput[],
    pagination: { page: number; pageSize: number },
  ) {
    const [items, total] = await Promise.all([
      this.prisma.userMedicineDoseLog.findMany({
        where,
        orderBy,
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.userMedicineDoseLog.count({ where }),
    ]);
    return { items, total };
  }

  override findFirst(
    where: Prisma.UserMedicineDoseLogWhereInput,
    options?: {
      select?: Prisma.UserMedicineDoseLogSelect;
      orderBy?: Prisma.UserMedicineDoseLogOrderByWithRelationInput[];
    },
  ) {
    const args: Parameters<
      PrismaService['userMedicineDoseLog']['findFirst']
    >[0] = { where };
    if (options?.select !== undefined) args.select = options.select;
    if (options?.orderBy !== undefined) args.orderBy = options.orderBy;
    return this.prisma.userMedicineDoseLog.findFirst(args);
  }

  override create(
    data: Prisma.UserMedicineDoseLogUncheckedCreateInput,
  ): ResultAsync<Prisma.UserMedicineDoseLogGetPayload<object>, DomainFailure> {
    return fromPrismaResult(this.prisma.userMedicineDoseLog.create({ data }));
  }

  override update(
    where: Prisma.UserMedicineDoseLogWhereUniqueInput,
    data:
      | Prisma.UserMedicineDoseLogUpdateInput
      | Prisma.UserMedicineDoseLogUncheckedUpdateInput,
  ): ResultAsync<Prisma.UserMedicineDoseLogGetPayload<object>, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userMedicineDoseLog.update({ where, data }),
    );
  }

  override findReminderById(userId: string, id: string) {
    return this.prisma.nonDeleted.userMedicineReminder.findFirst({
      where: { id, userId },
      select: {
        userId: true,
        currentMedicineId: true,
        scheduledHour: true,
        scheduledMinute: true,
      },
    });
  }

  override findCurrentMedicineById(userId: string, id: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id, userId },
      select: { userId: true },
    });
  }
}
