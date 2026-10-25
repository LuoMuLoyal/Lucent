/**
 * Prisma implementation of `DoseLogs` and `DoseLogFacts`.
 *
 * ## Both ports, one class
 *
 * The write-side repository and the cross-context reader answer questions about
 * the same table. Splitting them into two adapters would mean two places to keep
 * the "not deleted" predicate correct; one class keeps that predicate in a single
 * spot.
 *
 * ## Prisma types stop here
 *
 * The domain ports speak `DoseLogRecord` / `NewDoseLog` / `DoseLogPatch`, never
 * `Prisma.UserMedicineDoseLog*`. Mapping happens in `toRecord`.
 *
 * ## Errors
 *
 * Mapped storage outcomes (P2002 -> conflict, P2025 -> not found) reject with a
 * `DomainFailureException` carrying the failure; the use cases unwrap it back into
 * their Result channel. Anything else propagates untouched so a connection loss
 * never becomes a 4xx.
 */

import { Injectable } from '@nestjs/common';
import { Prisma, type DoseLogStatus } from '#generated/prisma/client.js';

import { PrismaService } from '../../../../prisma/index.js';
import { mapPrismaKnownRequestError } from '../../../../common/helpers/prisma/prisma-result.utils.js';
import { nonDeleted } from '../../../../common/index.js';
import { DomainFailureException } from '../../../../common/result/index.js';
import type { DoseLogFact } from '../../domain/dose-log/dose-log-facts.js';
import { MedicineDoseLogReaderPort } from '../../domain/dose-log/dose-log-facts.js';
import type {
  DoseLogPatch,
  DoseLogRecord,
  NewDoseLog,
  OwnedCurrentMedicine,
  ReminderSchedule,
} from '../../domain/dose-log/dose-logs.js';
import { DoseLogs } from '../../domain/dose-log/dose-logs.js';

/**
 * Hard upper bound on facts returned by the reader port. Prevents unbounded
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

@Injectable()
export class PrismaDoseLogs
  extends DoseLogs
  implements MedicineDoseLogReaderPort
{
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listByDate(
    userId: string,
    date: Date,
    pagination: { page: number; pageSize: number },
  ): Promise<{ items: DoseLogRecord[]; total: number }> {
    const where: Prisma.UserMedicineDoseLogWhereInput = {
      userId,
      scheduledFor: date,
      ...nonDeleted,
    };
    const [items, total] = await Promise.all([
      this.prisma.userMedicineDoseLog.findMany({
        where,
        orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'desc' }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.userMedicineDoseLog.count({ where }),
    ]);
    return { items: items.map(toRecord), total };
  }

  async findBySlot(
    userId: string,
    slot: {
      reminderId: string;
      scheduledFor: Date;
      scheduledTime: string | null;
    },
  ): Promise<DoseLogRecord | null> {
    const row = await this.prisma.userMedicineDoseLog.findFirst({
      where: {
        userId,
        reminderId: slot.reminderId,
        scheduledFor: slot.scheduledFor,
        scheduledTime: slot.scheduledTime,
        ...nonDeleted,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return row === null ? null : toRecord(row);
  }

  async findOwned(
    userId: string,
    id: string,
  ): Promise<{ userId: string; scheduledFor: Date } | null> {
    return await this.prisma.userMedicineDoseLog.findFirst({
      where: { id, userId, ...nonDeleted },
      select: { userId: true, scheduledFor: true },
    });
  }

  async create(input: NewDoseLog): Promise<DoseLogRecord> {
    const row = await this.lift(
      this.prisma.userMedicineDoseLog.create({
        data: {
          userId: input.userId,
          currentMedicineId: input.currentMedicineId,
          reminderId: input.reminderId,
          status: input.status as DoseLogStatus,
          scheduledFor: input.scheduledFor,
          scheduledTime: input.scheduledTime,
          takenAt: input.takenAt,
          doseText: input.doseText,
          note: input.note,
          healthEventId: input.healthEventId,
        },
      }),
    );
    return toRecord(row);
  }

  async update(id: string, patch: DoseLogPatch): Promise<DoseLogRecord> {
    const data: Prisma.UserMedicineDoseLogUncheckedUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status as DoseLogStatus;
    if (patch.scheduledTime !== undefined) {
      data.scheduledTime = patch.scheduledTime;
    }
    if (patch.takenAt !== undefined) data.takenAt = patch.takenAt;
    if (patch.doseText !== undefined) data.doseText = patch.doseText;
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.healthEventId !== undefined) {
      data.healthEventId = patch.healthEventId;
    }
    if (patch.currentMedicineId !== undefined) {
      data.currentMedicineId = patch.currentMedicineId;
    }
    if (patch.reminderId !== undefined) data.reminderId = patch.reminderId;
    const row = await this.lift(
      this.prisma.userMedicineDoseLog.update({ where: { id }, data }),
    );
    return toRecord(row);
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.lift(
      this.prisma.userMedicineDoseLog.update({
        where: { id },
        data: { deletedAt: at },
      }),
    );
  }

  findReminder(
    userId: string,
    reminderId: string,
  ): Promise<ReminderSchedule | null> {
    return this.prisma.nonDeleted.userMedicineReminder.findFirst({
      where: { id: reminderId, userId },
      select: {
        userId: true,
        currentMedicineId: true,
        scheduledHour: true,
        scheduledMinute: true,
      },
    });
  }

  findOwnedCurrentMedicine(
    userId: string,
    currentMedicineId: string,
  ): Promise<OwnedCurrentMedicine | null> {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id: currentMedicineId, userId },
      select: { userId: true },
    });
  }

  // ── DosageLogFacts (cross-context reads, ADR-0009) ─────────────────────────

  listFactsInRange(
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

  countFactsInRange(userId: string, from: Date, to: Date): Promise<number> {
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

  /**
   * Runs a Prisma write, converting mapped request errors into the exception form
   * of their `DomainFailure`. Unknown errors keep their identity.
   */
  private async lift<T>(write: Promise<T>): Promise<T> {
    try {
      return await write;
    } catch (error) {
      const failure = mapPrismaKnownRequestError(error);
      if (failure != null) {
        throw new DomainFailureException(failure);
      }
      throw error;
    }
  }
}

function toRecord(
  row: Prisma.UserMedicineDoseLogGetPayload<object>,
): DoseLogRecord {
  return {
    id: row.id,
    userId: row.userId,
    healthEventId: row.healthEventId,
    currentMedicineId: row.currentMedicineId,
    reminderId: row.reminderId,
    status: row.status,
    scheduledFor: row.scheduledFor,
    scheduledTime: row.scheduledTime,
    doseText: row.doseText,
    note: row.note,
    source: row.source,
    takenAt: row.takenAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
