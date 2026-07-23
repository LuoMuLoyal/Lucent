/**
 * Repository abstraction for AssistantSummaryHistory data access.
 *
 * Decouples HistoricalAiSummaryService from direct PrismaService usage.
 */
import { Injectable } from '@nestjs/common';
import { AiSummaryHistoryKind, type Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { formatDateOnly, parseDateOnly } from '../../../common/helpers';
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
}

export interface TodaySummaryRow {
  date: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  action: string;
  confidenceNote: string;
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
  }): TodaySummaryRow {
    return {
      date: formatDateOnly(row.date),
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: this.readBullets(row.bullets),
      actionLabel: row.actionLabel,
      action: row.action,
      confidenceNote: row.confidenceNote,
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
