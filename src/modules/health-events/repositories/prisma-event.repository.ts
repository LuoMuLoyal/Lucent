import { Injectable } from '@nestjs/common';
import {
  HealthEventOutcome,
  HealthEventStatus,
  Prisma,
} from '#generated/prisma/client';
import { parseDateOnly } from '../../../common';
import { PrismaService } from '../../../prisma';
import {
  HealthEventActiveConflictError,
  HealthEventRepositoryPort,
  type HealthEventCheckInRecord,
  type HealthEventCoverageRecord,
  type HealthEventCreateInput,
  type HealthEventPageQuery,
  type HealthEventRecord,
  type HealthEventUpdateInput,
} from './event.repository';

const eventSelect = {
  id: true,
  userId: true,
  title: true,
  kind: true,
  status: true,
  startedAt: true,
  endedAt: true,
  outcome: true,
  reasonRecordId: true,
  deletedAt: true,
  medicines: { select: { currentMedicineId: true } },
} satisfies Prisma.HealthEventSelect;

const checkInSelect = {
  id: true,
  eventId: true,
  date: true,
  outcome: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.HealthEventCheckInSelect;

type HealthEventRow = Prisma.HealthEventGetPayload<{
  select: typeof eventSelect;
}>;

type LockedHealthEventRow = {
  id: string;
  status: HealthEventStatus;
};

@Injectable()
export class PrismaEventRepository extends HealthEventRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override async findActiveByUserId(userId: string) {
    const row = await this.prisma.healthEvent.findFirst({
      where: {
        userId,
        status: HealthEventStatus.active,
        deletedAt: null,
      },
      select: eventSelect,
    });
    return row == null ? null : this.toEventRecord(row);
  }

  override async findById(userId: string, eventId: string) {
    const row = await this.prisma.healthEvent.findFirst({
      where: {
        id: eventId,
        userId,
        deletedAt: null,
      },
      select: eventSelect,
    });
    return row == null ? null : this.toEventRecord(row);
  }

  override async findManyByUserId(userId: string) {
    const rows = await this.prisma.healthEvent.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: eventSelect,
    });
    return rows.map((row) => this.toEventRecord(row));
  }

  override async findPageByUserId(userId: string, query: HealthEventPageQuery) {
    const statusWhere: Prisma.HealthEventWhereInput = {
      userId,
      deletedAt: null,
    };
    if (query.status != null) {
      statusWhere.status = query.status;
    }
    const pageWhere: Prisma.HealthEventWhereInput =
      query.cursor == null
        ? statusWhere
        : {
            ...statusWhere,
            OR: [
              { startedAt: { lt: query.cursor.startedAt } },
              {
                startedAt: query.cursor.startedAt,
                id: { lt: query.cursor.id },
              },
            ],
          };

    // Two independent queries: the page rows (one extra row probes whether
    // another page exists) and the status-filtered total. The cursor bound
    // deliberately does not apply to the count, so `total` is an approximate
    // snapshot — it counts the whole filter, not the remaining pages.
    const [rows, total] = await Promise.all([
      this.prisma.healthEvent.findMany({
        where: pageWhere,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        // One extra row probes whether another page exists.
        take: query.limit + 1,
        select: eventSelect,
      }),
      this.prisma.healthEvent.count({ where: statusWhere }),
    ]);
    const hasMore = rows.length > query.limit;
    return {
      items: rows.slice(0, query.limit).map((row) => this.toEventRecord(row)),
      hasMore,
      total,
    };
  }

  override async findMostRecentEndedByUserId(userId: string) {
    const row = await this.prisma.healthEvent.findFirst({
      where: {
        userId,
        status: HealthEventStatus.ended,
        deletedAt: null,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: eventSelect,
    });
    return row == null ? null : this.toEventRecord(row);
  }

  override async findCheckIn(userId: string, eventId: string, date: string) {
    const row = await this.prisma.healthEventCheckIn.findFirst({
      where: {
        eventId,
        date: parseDateOnly(date),
        event: { userId, deletedAt: null },
      },
      select: checkInSelect,
    });
    return row == null ? null : this.toCheckInRecord(row);
  }

  override async findCheckIns(userId: string, eventId: string) {
    const rows = await this.prisma.healthEventCheckIn.findMany({
      where: {
        eventId,
        event: { userId, deletedAt: null },
      },
      select: checkInSelect,
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => this.toCheckInRecord(row));
  }

  override async findCheckInCoverage(
    userId: string,
    eventId: string,
  ): Promise<HealthEventCoverageRecord> {
    const rows = await this.prisma.healthEventCheckIn.findMany({
      where: {
        eventId,
        event: { userId, deletedAt: null },
      },
      select: { date: true },
      orderBy: { date: 'asc' },
    });
    return {
      checkInCount: rows.length,
      firstCheckInDate: rows[0]?.date ?? null,
      lastCheckInDate: rows.at(-1)?.date ?? null,
    };
  }

  override async findOwnedCurrentMedicineIds(
    userId: string,
    medicineIds: string[],
  ): Promise<string[]> {
    if (medicineIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.userCurrentMedicine.findMany({
      where: { userId, id: { in: medicineIds }, isCurrent: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  override async findOwnedReasonRecord(
    userId: string,
    recordId: string,
  ): Promise<boolean> {
    const row = await this.prisma.userDailyRecord.findFirst({
      where: { id: recordId, userId, deletedAt: null },
      select: { id: true },
    });
    return row != null;
  }

  override async create(input: HealthEventCreateInput) {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.healthEvent.create({
          data: {
            userId: input.userId,
            title: input.title,
            kind: input.kind,
            status: input.status,
            startedAt: input.startedAt,
            reasonRecordId: input.reasonRecordId,
          },
          select: { id: true },
        });

        if (input.currentMedicineIds.length > 0) {
          await tx.healthEventMedicine.createMany({
            data: input.currentMedicineIds.map((currentMedicineId) => ({
              eventId: created.id,
              currentMedicineId,
            })),
          });
        }

        return tx.healthEvent.findFirst({
          where: { id: created.id, userId: input.userId, deletedAt: null },
          select: eventSelect,
        });
      });

      if (row == null) {
        throw new Error('Created health event could not be read back.');
      }
      return this.toEventRecord(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HealthEventActiveConflictError();
      }
      throw error;
    }
  }

  override async update(
    userId: string,
    eventId: string,
    input: HealthEventUpdateInput,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const event = await this.lockEvent(tx, userId, eventId);
      if (event?.status !== HealthEventStatus.active) {
        return null;
      }

      const result = await tx.healthEvent.updateMany({
        where: {
          id: eventId,
          userId,
          status: HealthEventStatus.active,
          deletedAt: null,
        },
        data: {
          status: input.status,
          endedAt: input.endedAt,
          outcome: input.outcome,
        },
      });

      if (result.count === 0) {
        return null;
      }

      return true;
    });

    if (!updated) {
      return null;
    }

    const row = await this.prisma.healthEvent.findFirst({
      where: { id: eventId, userId, deletedAt: null },
      select: eventSelect,
    });
    return row == null ? null : this.toEventRecord(row);
  }

  override async upsertCheckIn(
    userId: string,
    eventId: string,
    date: string,
    outcome: HealthEventOutcome,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const event = await this.lockEvent(tx, userId, eventId);
      if (event?.status !== HealthEventStatus.active) {
        return null;
      }

      return tx.healthEventCheckIn.upsert({
        where: {
          eventId_date: { eventId, date: parseDateOnly(date) },
        },
        create: { eventId, date: parseDateOnly(date), outcome },
        update: { outcome },
        select: checkInSelect,
      });
    }) as Promise<HealthEventCheckInRecord | null>;
  }

  private async lockEvent(
    tx: Prisma.TransactionClient,
    userId: string,
    eventId: string,
  ): Promise<LockedHealthEventRow | null> {
    const rows = await tx.$queryRaw<LockedHealthEventRow[]>(Prisma.sql`
      SELECT id, status
      FROM health_events
      WHERE id = ${eventId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  override async findUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { profile: { select: { timezone: true } } },
    });
    return user?.profile?.timezone ?? null;
  }

  private toEventRecord(row: HealthEventRow): HealthEventRecord {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      kind: row.kind,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      outcome: row.outcome,
      reasonRecordId: row.reasonRecordId,
      deletedAt: row.deletedAt,
      currentMedicineIds: row.medicines.map(
        (medicine) => medicine.currentMedicineId,
      ),
    };
  }

  private toCheckInRecord(
    row: Prisma.HealthEventCheckInGetPayload<{
      select: typeof checkInSelect;
    }>,
  ): HealthEventCheckInRecord {
    return row;
  }
}
