/**
 * Summary use cases (ADR-0024 `application/use_cases`).
 *
 * Thin by design: the version fence and scope addressability are rules of the
 * `Summary` aggregate (`domain/summary/summary.ts`) and are applied by the
 * persistence implementation that can actually see the stored version. This
 * service is the query surface the reports context and the read tools consume.
 */

import { Injectable } from '@nestjs/common';
import type {
  ReportRangeQuery,
  ReportSummaryRecord,
  SummaryRepositoryPort,
  SummaryWrite,
  TodaySummaryRecord,
} from '../../domain/summary/summaries.js';
import type { AssistantReportRange } from '../ports/readers.js';

export type {
  ReportRangeQuery,
  ReportSummaryRecord,
  SummaryWrite,
  TodaySummaryRecord,
} from '../../domain/summary/summaries.js';
export type { SummaryBullet } from '../../domain/summary/summaries.js';

@Injectable()
export class HistoricalAiSummaryService {
  constructor(private readonly repository: SummaryRepositoryPort) {}

  /**
   * Stores a summary. `written: false` means the aggregate's version fence
   * refused it (a newer version is already stored) — an expected outcome, not an
   * error.
   */
  save(input: SummaryWrite): Promise<{ written: boolean }> {
    return this.repository.save(input);
  }

  listRecentTodaySummaries(
    userId: string,
    limit = 7,
  ): Promise<TodaySummaryRecord[]> {
    return this.repository.listRecentToday(userId, limit);
  }

  listRecentReportSummaries(
    userId: string,
    limit = 6,
  ): Promise<ReportSummaryRecord[]> {
    return this.repository.listRecentReports(userId, limit);
  }

  getLatestTodaySummaryByDate(
    userId: string,
    date: string,
  ): Promise<TodaySummaryRecord | null> {
    return this.repository.findTodayByDate(userId, date);
  }

  getLatestReportSummaryByRange(
    userId: string,
    input: ReportRangeQuery,
  ): Promise<ReportSummaryRecord | null> {
    return this.repository.findReportByRange(userId, input);
  }
}

export type { AssistantReportRange };
