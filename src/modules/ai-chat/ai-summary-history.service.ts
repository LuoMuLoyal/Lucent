import { Injectable } from '@nestjs/common';
import {
  AiSummaryHistoryKind,
  type Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type SummaryBullet = {
  kind: string;
  text: string;
};

type PersistSummaryInput = {
  userId: string;
  kind: 'today' | 'report';
  scopeKey: string;
  date?: string | null;
  rangeKey?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  generatedAt: string;
  summary: string;
  bullets: SummaryBullet[];
  actionLabel: string;
  confidenceNote: string;
};

@Injectable()
export class AiSummaryHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: PersistSummaryInput): Promise<void> {
    await this.prisma.aiSummaryHistory.upsert({
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

  async listRecentTodaySummaries(userId: string, limit = 7) {
    const rows = await this.prisma.aiSummaryHistory.findMany({
      where: {
        userId,
        kind: AiSummaryHistoryKind.today,
      },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });

    return rows.map((row) => ({
      date: row.date?.toISOString().slice(0, 10) ?? null,
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: this.readBullets(row.bullets),
      actionLabel: row.actionLabel,
      confidenceNote: row.confidenceNote,
    }));
  }

  async listRecentReportSummaries(userId: string, limit = 6) {
    const rows = await this.prisma.aiSummaryHistory.findMany({
      where: {
        userId,
        kind: AiSummaryHistoryKind.report,
      },
      orderBy: [{ generatedAt: 'desc' }],
      take: limit,
    });

    return rows.map((row) => ({
      rangeKey: row.rangeKey,
      startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
      generatedAt: row.generatedAt.toISOString(),
      summary: row.summary,
      bullets: this.readBullets(row.bullets),
      actionLabel: row.actionLabel,
      confidenceNote: row.confidenceNote,
    }));
  }

  private toUpsertData(
    input: PersistSummaryInput,
  ): Prisma.AiSummaryHistoryUncheckedCreateInput {
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
      confidenceNote: input.confidenceNote,
    };
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (value == null || value.trim().length === 0) {
      return null;
    }
    return new Date(`${value}T00:00:00.000Z`);
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
