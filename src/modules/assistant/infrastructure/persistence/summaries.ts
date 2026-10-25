/**
 * Prisma implementation of `SummaryRepositoryPort`
 * (`domain/summary/summaries.ts`, ADR-0024 §4).
 *
 * The version fence used to be inline SQL logic in
 * `repositories/summary.repository.ts`. It now lives in the aggregate
 * (`mayReplaceSummary`) and this file **applies** the decision: it reads the
 * stored `sourceVersion`, asks the aggregate, and either writes or reports
 * `{ written: false }`. The unique-key race between two concurrent writers is
 * still handled here, because it is a storage fact (`P2002` on
 * `(userId, scopeKey)`) that the domain has no way to observe.
 */

import { Injectable } from '@nestjs/common';
import { AiSummaryHistoryKind, type Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../../prisma/index.js';
import { formatDateOnly, parseDateOnly } from '../../../../common/index.js';
import { mayReplaceSummary, scopeKeyOf } from '../../domain/summary/summary.js';
import type { SummaryScope } from '../../domain/summary/summary.js';
import type {
  ReportRangeQuery,
  ReportSummaryRecord,
  SummaryBullet,
  SummaryRepositoryPort,
  SummaryWrite,
  TodaySummaryRecord,
} from '../../domain/summary/summaries.js';

function parseDate(value: string | null | undefined): Date | null {
  if (value == null || value.trim().length === 0) {
    return null;
  }
  return parseDateOnly(value);
}

function readBullets(raw: unknown): SummaryBullet[] {
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

function isUniqueConflict(error: unknown): boolean {
  return (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class PrismaSummaries implements SummaryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(write: SummaryWrite): Promise<{ written: boolean }> {
    const scope = this.scopeOf(write);
    const scopeKey = scopeKeyOf(scope);
    if (scopeKey == null) {
      // An unaddressable scope has no row to own; storing it would collide with
      // an addressable one. The caller built the scope, so this is a bug there.
      return { written: false };
    }

    const data = this.toUpsertData(write, scope, scopeKey);
    const existing = await this.prisma.assistantSummaryHistory.findUnique({
      where: { userId_scopeKey: { userId: write.userId, scopeKey } },
      select: { sourceVersion: true },
    });

    const allowed = mayReplaceSummary({
      storedSourceVersion: existing?.sourceVersion ?? null,
      incomingSourceVersion: write.sourceVersion ?? null,
    });
    if (!allowed) {
      return { written: false };
    }

    if (existing == null) {
      try {
        await this.prisma.assistantSummaryHistory.create({ data });
        return { written: true };
      } catch (error) {
        if (!isUniqueConflict(error)) {
          throw error;
        }
        // Another writer created the row first: re-apply the fence so an older
        // version cannot replace a newer one.
        const raced = await this.prisma.assistantSummaryHistory.findUnique({
          where: { userId_scopeKey: { userId: write.userId, scopeKey } },
          select: { sourceVersion: true },
        });
        if (
          !mayReplaceSummary({
            storedSourceVersion: raced?.sourceVersion ?? null,
            incomingSourceVersion: write.sourceVersion ?? null,
          })
        ) {
          return { written: false };
        }
      }
    }

    await this.prisma.assistantSummaryHistory.updateMany({
      where: { userId: write.userId, scopeKey },
      data,
    });
    return { written: true };
  }

  async listRecentToday(
    userId: string,
    limit: number,
  ): Promise<TodaySummaryRecord[]> {
    const rows = await this.prisma.assistantSummaryHistory.findMany({
      where: { userId, kind: AiSummaryHistoryKind.today },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.toTodayRecord(row));
  }

  async listRecentReports(
    userId: string,
    limit: number,
  ): Promise<ReportSummaryRecord[]> {
    const rows = await this.prisma.assistantSummaryHistory.findMany({
      where: { userId, kind: AiSummaryHistoryKind.report },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.toReportRecord(row));
  }

  async findTodayByDate(
    userId: string,
    date: string,
  ): Promise<TodaySummaryRecord | null> {
    const row = await this.prisma.assistantSummaryHistory.findFirst({
      where: {
        userId,
        kind: AiSummaryHistoryKind.today,
        date: parseDate(date),
      },
      orderBy: [{ generatedAt: 'desc' }],
    });
    return row == null ? null : this.toTodayRecord(row);
  }

  async findReportByRange(
    userId: string,
    query: ReportRangeQuery,
  ): Promise<ReportSummaryRecord | null> {
    const row = await this.prisma.assistantSummaryHistory.findFirst({
      where: {
        userId,
        kind: AiSummaryHistoryKind.report,
        ...(query.rangeKey != null ? { rangeKey: query.rangeKey } : {}),
        ...(query.startDate != null
          ? { startDate: parseDate(query.startDate) }
          : {}),
        ...(query.endDate != null ? { endDate: parseDate(query.endDate) } : {}),
      },
      orderBy: [{ generatedAt: 'desc' }],
    });
    return row == null ? null : this.toReportRecord(row);
  }

  /**
   * Normalises a write into a scope.
   *
   * Callers still send the legacy flat shape (`kind`/`date`/`rangeKey` at the
   * top level); `scope` is the domain form. Both are accepted and the domain one
   * wins, so the storage key can never disagree with the fields it names.
   */
  private scopeOf(write: SummaryWrite): SummaryScope {
    if (write.scope != null) {
      return write.scope;
    }
    return {
      kind: write.kind ?? 'today',
      date: write.date ?? null,
      rangeKey: write.rangeKey ?? null,
      startDate: write.startDate ?? null,
      endDate: write.endDate ?? null,
    };
  }

  private toUpsertData(
    write: SummaryWrite,
    scope: SummaryScope,
    scopeKey: string,
  ): Prisma.AssistantSummaryHistoryUncheckedCreateInput {
    const isToday = scope.kind === 'today';

    const data: Prisma.AssistantSummaryHistoryUncheckedCreateInput = {
      userId: write.userId,
      kind: isToday ? AiSummaryHistoryKind.today : AiSummaryHistoryKind.report,
      scopeKey,
      date: parseDate(scope.date),
      rangeKey: scope.rangeKey ?? null,
      startDate: parseDate(scope.startDate),
      endDate: parseDate(scope.endDate),
      generatedAt: new Date(write.generatedAt),
      summary: write.summary,
      bullets: (isToday ? (write.bullets ?? []) : []) as never,
      actionLabel: isToday ? (write.actionLabel ?? '') : '',
      action: isToday ? (write.action ?? '') : '',
      confidenceNote: isToday ? (write.confidenceNote ?? '') : '',
      aiGenerated: write.aiGenerated ?? false,
      sourceVersion: write.sourceVersion ?? null,
    };

    if (!isToday) {
      const payload: Record<string, unknown> = {};
      if (write.coverage != null) {
        payload['coverage'] = write.coverage;
      }
      if (write.observedPattern !== undefined) {
        payload['observedPattern'] = write.observedPattern;
      }
      if (write.lowRiskAction !== undefined) {
        payload['lowRiskAction'] = write.lowRiskAction;
      }
      if (write.disclaimer != null) {
        payload['disclaimer'] = write.disclaimer;
      }
      if (Object.keys(payload).length > 0) {
        data.payload = payload as never;
      }
    }
    return data;
  }

  private toTodayRecord(row: {
    date: Date | null;
    generatedAt: Date;
    summary: string;
    bullets: unknown;
    actionLabel: string;
    action: string;
    confidenceNote: string;
    aiGenerated: boolean;
    sourceVersion: number | null;
  }): TodaySummaryRecord {
    return {
      date: formatDateOnly(row.date),
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: readBullets(row.bullets),
      actionLabel: row.actionLabel,
      action: row.action,
      confidenceNote: row.confidenceNote,
      aiGenerated: row.aiGenerated,
      sourceVersion: row.sourceVersion,
    };
  }

  private toReportRecord(row: {
    rangeKey: string | null;
    startDate: Date | null;
    endDate: Date | null;
    generatedAt: Date;
    summary: string;
    bullets: unknown;
    actionLabel: string;
    action: string;
    confidenceNote: string;
    payload: unknown;
  }): ReportSummaryRecord {
    const payload = this.readReportPayload(row.payload);
    return {
      rangeKey: row.rangeKey,
      startDate: formatDateOnly(row.startDate),
      endDate: formatDateOnly(row.endDate),
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      coverage: payload?.coverage ?? null,
      observedPattern: payload?.observedPattern ?? null,
      lowRiskAction: payload?.lowRiskAction ?? null,
      disclaimer: payload?.disclaimer ?? null,
      bullets: readBullets(row.bullets),
      actionLabel: row.actionLabel,
      action: row.action,
      confidenceNote: row.confidenceNote,
    };
  }

  private readReportPayload(raw: unknown): {
    coverage?: ReportSummaryRecord['coverage'];
    observedPattern?: ReportSummaryRecord['observedPattern'];
    lowRiskAction?: ReportSummaryRecord['lowRiskAction'];
    disclaimer?: string | null;
  } | null {
    if (raw == null || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    return {
      ...(obj['coverage'] != null
        ? { coverage: obj['coverage'] as ReportSummaryRecord['coverage'] }
        : {}),
      ...(obj['observedPattern'] !== undefined
        ? {
            observedPattern: obj[
              'observedPattern'
            ] as ReportSummaryRecord['observedPattern'],
          }
        : {}),
      ...(obj['lowRiskAction'] !== undefined
        ? {
            lowRiskAction: obj[
              'lowRiskAction'
            ] as ReportSummaryRecord['lowRiskAction'],
          }
        : {}),
      ...(obj['disclaimer'] != null
        ? { disclaimer: obj['disclaimer'] as string }
        : {}),
    };
  }
}
