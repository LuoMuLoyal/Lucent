import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/index.js';
import { nonDeleted, toInputJsonValue } from '../../../../common/index.js';
import {
  type MedicineRiskCheckRecordRow,
  type MedicineRiskCheckType,
  type MedicineReminderRow,
  type MedicineRiskRecordsPort,
  type UserHealthContext,
} from '../../application/ports/risk-records.js';

/** Prisma's `check_type` column is a free string; the port narrows it. */
function asCheckType(value: string): MedicineRiskCheckType {
  return value === 'llm' ? 'llm' : 'static';
}

type PrismaRiskCheckRecord = {
  checkType: string;
  result: unknown;
  riskScore: number;
  riskLevel: string;
  stale: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toRecordRow(row: PrismaRiskCheckRecord): MedicineRiskCheckRecordRow {
  return {
    checkType: asCheckType(row.checkType),
    result: row.result,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    stale: row.stale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma-backed implementation of the medicine risk-records port
 * (`application/ports/risk-records.ts`): risk-check record CRUD plus the user
 * health snapshot and reminder rows the risk-check use case consumes.
 */
@Injectable()
export class MedicineRiskRecordsStore implements MedicineRiskRecordsPort {
  constructor(private readonly prisma: PrismaService) {}

  async listRecords(userId: string): Promise<MedicineRiskCheckRecordRow[]> {
    const rows = await this.prisma.medicineRiskCheckRecord.findMany({
      where: { userId },
    });
    return rows.map(toRecordRow);
  }

  async upsertRecord(
    userId: string,
    checkType: MedicineRiskCheckType,
    payload: { result: unknown; riskScore: number; riskLevel: string },
  ): Promise<MedicineRiskCheckRecordRow> {
    const row = await this.prisma.medicineRiskCheckRecord.upsert({
      where: { userId_checkType: { userId, checkType } },
      create: {
        userId,
        checkType,
        result: toInputJsonValue(payload.result),
        riskScore: payload.riskScore,
        riskLevel: payload.riskLevel,
        stale: false,
      },
      update: {
        result: toInputJsonValue(payload.result),
        riskScore: payload.riskScore,
        riskLevel: payload.riskLevel,
        stale: false,
      },
    });
    return toRecordRow(row);
  }

  async markAllStale(userId: string): Promise<void> {
    await this.prisma.medicineRiskCheckRecord.updateMany({
      where: { userId },
      data: { stale: true },
    });
  }

  async loadHealthContext(
    userId: string,
    limit: number,
  ): Promise<UserHealthContext | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: {
        allergies: {
          where: { isActive: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        },
        conditions: {
          where: { status: 'active' },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        },
        currentMedicines: {
          where: { isCurrent: true },
          orderBy: { updatedAt: 'desc' },
          take: limit,
        },
      },
    });

    if (user == null) {
      return null;
    }

    return {
      allergies: user.allergies.map((a) => ({
        label: a.label,
        reaction: a.reaction,
        severity: a.severity,
        isActive: a.isActive,
      })),
      conditions: user.conditions.map((c) => ({
        label: c.label,
        status: c.status,
      })),
      currentMedicines: user.currentMedicines.map((m) => ({
        id: m.id,
        source: m.source,
        sourceRefId: m.sourceRefId,
        displayName: m.displayName,
        startedAt: m.startedAt,
      })),
    };
  }

  async listReminders(userId: string): Promise<MedicineReminderRow[]> {
    const reminders = await this.prisma.userMedicineReminder.findMany({
      where: { userId, isActive: true, ...nonDeleted },
      orderBy: [{ scheduledHour: 'asc' }, { scheduledMinute: 'asc' }],
    });
    return reminders.map((r) => ({
      currentMedicineId: r.currentMedicineId,
      scheduledHour: r.scheduledHour,
      scheduledMinute: r.scheduledMinute,
      daysOfWeek: r.daysOfWeek,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
  }
}
