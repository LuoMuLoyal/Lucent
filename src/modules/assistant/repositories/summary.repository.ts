/**
 * Repository abstraction for AssistantSummaryHistory data access.
 *
 * Decouples HistoricalAiSummaryService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { AiSummaryHistoryKind, type Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { formatDateOnly, parseDateOnly } from '../../../common';
import type { AssistantReportRange } from '../types/ports';

export type SummaryBullet = {
  kind: string;
  text: string;
};

export interface PersistSummaryInput {
  userId: string;
  kind: 'today' | 'report';
  scopeKey: string;
  date?: string | null;
  rangeKey?: AssistantReportRange | null;
  startDate?: string | null;
  endDate?: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
  sourceVersion?: number | null;
}

export interface TodaySummaryRow {
  date: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
  sourceVersion?: number | null;
}

export interface ReportSummaryRow {
  rangeKey: string | null;
  startDate: string | null;
  endDate: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
}

export interface ReportRangeInput {
  rangeKey?: AssistantReportRange | null;
  startDate?: string | null;
  endDate?: string | null;
}

export abstract class AssistantSummaryRepositoryPort {
  abstract save(input: PersistSummaryInput): Promise<void>;
  abstract listRecentTodaySummaries(
    userId: string,
    limit: number,
  ): Promise<TodaySummaryRow[]>;
  abstract listRecentReportSummaries(
    userId: string,
    limit: number,
  ): Promise<ReportSummaryRow[]>;
  abstract findLatestTodaySummaryByDate(
    userId: string,
    date: Date,
  ): Promise<TodaySummaryRow | null>;
  abstract findLatestReportSummaryByRange(
    userId: string,
    input: ReportRangeInput,
  ): Promise<ReportSummaryRow | null>;
}

@Injectable()
export class AssistantSummaryRepository implements AssistantSummaryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: PersistSummaryInput): Promise<void> {
    if (input.kind === 'today' && input.sourceVersion != null) {
      await this.saveVersionedTodaySummary(input);
      return;
    }

    await this.prisma.assistantSummaryHistory.upsert({
      where: {
        userId_scopeKey: {
          userId: input.userId,
          scopeKey: input.scopeKey,
        },
      },
      create: this.toUpsertData(input),
      update: this.toUpsertData(input),
    });
  }

  private async saveVersionedTodaySummary(
    input: PersistSummaryInput,
  ): Promise<void> {
    const sourceVersion = input.sourceVersion;
    if (sourceVersion == null) {
      return;
    }
    const where: Prisma.AssistantSummaryHistoryWhereInput = {
      userId: input.userId,
      scopeKey: input.scopeKey,
      kind: AiSummaryHistoryKind.today,
      OR: [{ sourceVersion: null }, { sourceVersion: { lte: sourceVersion } }],
    };
    const existing = await this.prisma.assistantSummaryHistory.findUnique({
      where: {
        userId_scopeKey: {
          userId: input.userId,
          scopeKey: input.scopeKey,
        },
      },
    });
    const data = this.toUpsertData(input);
    const updated = await this.prisma.assistantSummaryHistory.updateMany({
      where,
      data,
    });
    if (updated.count === 1 || existing != null) {
      return;
    }

    try {
      await this.prisma.assistantSummaryHistory.create({ data });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      // A newer writer may have won the unique-key race. Re-run the fenced
      // update so an older writer cannot replace it.
      await this.prisma.assistantSummaryHistory.updateMany({
        where,
        data,
      });
    }
  }

  async listRecentTodaySummaries(
    userId: string,
    limit: number,
  ): Promise<TodaySummaryRow[]> {
    const rows = await this.prisma.assistantSummaryHistory.findMany({
      where: { userId, kind: AiSummaryHistoryKind.today },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.toTodaySummary(row));
  }

  async listRecentReportSummaries(
    userId: string,
    limit: number,
  ): Promise<ReportSummaryRow[]> {
    const rows = await this.prisma.assistantSummaryHistory.findMany({
      where: { userId, kind: AiSummaryHistoryKind.report },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.toReportSummary(row));
  }

  async findLatestTodaySummaryByDate(
    userId: string,
    date: Date,
  ): Promise<TodaySummaryRow | null> {
    const row = await this.prisma.assistantSummaryHistory.findFirst({
      where: { userId, kind: AiSummaryHistoryKind.today, date },
      orderBy: [{ generatedAt: 'desc' }],
    });
    return row == null ? null : this.toTodaySummary(row);
  }

  async findLatestReportSummaryByRange(
    userId: string,
    input: ReportRangeInput,
  ): Promise<ReportSummaryRow | null> {
    const row = await this.prisma.assistantSummaryHistory.findFirst({
      where: {
        userId,
        kind: AiSummaryHistoryKind.report,
        ...(input.rangeKey != null ? { rangeKey: input.rangeKey } : {}),
        ...(input.startDate != null
          ? { startDate: this.parseDate(input.startDate) }
          : {}),
        ...(input.endDate != null
          ? { endDate: this.parseDate(input.endDate) }
          : {}),
      },
      orderBy: [{ generatedAt: 'desc' }],
    });
    return row == null ? null : this.toReportSummary(row);
  }

  private toUpsertData(
    input: PersistSummaryInput,
  ): Prisma.AssistantSummaryHistoryUncheckedCreateInput {
    return {
      userId: input.userId,
      kind:
        input.kind === 'today'
          ? AiSummaryHistoryKind.today
          : AiSummaryHistoryKind.report,
      scopeKey: input.scopeKey,
      date: this.parseDate(input.date),
      rangeKey: input.rangeKey ?? null,
      startDate: this.parseDate(input.startDate),
      endDate: this.parseDate(input.endDate),
      generatedAt: new Date(input.generatedAt),
      summary: input.summary,
      bullets: input.bullets,
      actionLabel: input.actionLabel,
      action: input.action,
      confidenceNote: input.confidenceNote,
      sourceVersion: input.sourceVersion ?? null,
    };
  }

  private toTodaySummary(row: {
    date: Date | null;
    generatedAt: Date;
    summary: string;
    bullets: unknown;
    actionLabel: string;
    action: string;
    confidenceNote: string;
    sourceVersion?: number | null;
  }): TodaySummaryRow {
    return {
      date: formatDateOnly(row.date),
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: this.readBullets(row.bullets),
      actionLabel: row.actionLabel,
      action: row.action,
      confidenceNote: row.confidenceNote,
      sourceVersion: row.sourceVersion ?? null,
    };
  }

  private toReportSummary(row: {
    rangeKey: string | null;
    startDate: Date | null;
    endDate: Date | null;
    generatedAt: Date;
    summary: string;
    bullets: unknown;
    actionLabel: string;
    action: string;
    confidenceNote: string;
  }): ReportSummaryRow {
    return {
      rangeKey: row.rangeKey,
      startDate: formatDateOnly(row.startDate),
      endDate: formatDateOnly(row.endDate),
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: this.readBullets(row.bullets),
      actionLabel: row.actionLabel,
      action: row.action,
      confidenceNote: row.confidenceNote,
    };
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (value == null || value.trim().length === 0) {
      return null;
    }
    return parseDateOnly(value);
  }

  private readBullets(raw: unknown): SummaryBullet[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((item) => {
      if (
        item != null &&
        typeof item === 'object' &&
        'kind' in item &&
        'text' in item &&
        typeof (item as { kind?: unknown }).kind === 'string' &&
        typeof (item as { text?: unknown }).text === 'string'
      ) {
        return [
          {
            kind: (item as { kind: string }).kind,
            text: (item as { text: string }).text,
          },
        ];
      }
      return [];
    });
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
